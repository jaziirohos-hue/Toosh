#!/usr/bin/env bash
# Real-SMS end-to-end test on an Android emulator (run by CI; see .github/workflows/ci.yml).
# Requires: a running emulator, the Toosh API on the host at :8787 (reached from the emulator as 10.0.2.2),
# and the debug + androidTest APKs built from app/android.
set -euo pipefail
cd "$(dirname "$0")/.."
PKG=so.toosh.app
OUT=build/e2e
mkdir -p "$OUT"
# On failure keep the app's own diagnostic log (outcome codes only; no SMS text is ever logged).
trap 'adb logcat -d -s Toosh TooshE2E AndroidRuntime WM-WorkerWrapper > "$OUT/logcat.txt" 2>&1 || true; tail -n 60 "$OUT/logcat.txt" || true' ERR

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# Runtime permissions the person grants in the app's own permission screens.
for p in RECEIVE_SMS READ_SMS READ_PHONE_STATE POST_NOTIFICATIONS; do adb shell pm grant "$PKG" "android.permission.$p" || true; done

step() {
  local name=$1; shift
  adb shell am instrument -w -e step "$name" "$@" -e class so.toosh.app.RealSmsFlowTest "$PKG.test/androidx.test.runner.AndroidJUnitRunner" | tee "$OUT/$name.txt"
  grep -q "^OK (" "$OUT/$name.txt"
  # A skipped step would also print OK; require the step's own confirmation line.
  adb logcat -d -s TooshE2E | grep -q "step-ok $name" || { echo "step $name did not run"; return 1; }
}
evc_time() { TZ=Africa/Mogadishu date -d "$1" '+%d/%m/%y %H:%M:%S'; }
send() { adb emu sms send "$1" "$2"; sleep 3; }

step prepare

# Real modem SMS. The app UI is not open: capture runs from the manifest receiver and background work only.
send 192 "[-EVCPlus-] \$3.90 ayaad uwareejisay Qof Tusaale(615551288), Tar: $(evc_time '-2 min') Haraagaagu waa \$51.59."
send 192 "[-EVCPLUS-] waxaad \$3 ka heshay 615998822, Tar: $(evc_time '-1 min') haraagagu waa \$54.585."
send 192 "[-EVCPlus-] \$15.00 waxaad u dirtay 615998822 Tariikh: $(evc_time 'now'). Ma cadda qaabka wareejinta."
LONG="[-EVCPlus-] \$2.50 waxaad u dirtay 615443312 Tariikh: $(evc_time 'now'). Fariintan waa mid dheer oo loo qaybiyay dhowr qaybood si loo hubiyo in Toosh uu si sax ah isugu daro qaybaha fariimaha dhaadheer ee EVC Plus kahor intaan la kaydin."
send 192 "$LONG"
# Noise that must never be stored: a personal SMS and a non-EVC message from an EVC sender.
send 5551234 "Salaan, sidee tahay? Waxaan kuu soo diray \$5 shalay."
send 192 "Your OTP is 123456"

step verify -e expect 4 -e longBodyB64 "$(printf '%s' "$LONG" | base64 -w0)"

# Offline: the SMS still arrives over the radio, is stored, and waits.
adb shell svc wifi disable
adb shell svc data disable
send 192 "[-EVCPLUS-] waxaad \$10 ka heshay Sahra Maxamed (615443312), Tar: $(evc_time 'now') haraagagu waa \$64.585."
step offline -e expect 4

# Back online: WorkManager uploads it without the app being opened.
adb shell svc wifi enable
adb shell svc data enable
step reconnected -e expect 5

# Screenshots of the native build: the launch splash, the signed-in app, and the launcher icon in the app drawer.
adb shell am force-stop "$PKG" || true
adb shell am start -n "$PKG/.MainActivity" || true
sleep 0.6
adb exec-out screencap -p > "$OUT/app-splash.png" || true
sleep 8
adb exec-out screencap -p > "$OUT/app-launch.png" || true
adb shell input keyevent KEYCODE_HOME || true
sleep 2
size=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1); w=${size%x*}; h=${size#*x}
adb shell input swipe $((w / 2)) $((h * 85 / 100)) $((w / 2)) $((h * 20 / 100)) 300 || true
sleep 2
adb exec-out screencap -p > "$OUT/launcher-drawer.png" || true
# Large phone font size (130%): every screen checked inside the real WebView for text spilling out of its box.
(cd ../.. && npx tsx app/android/scripts/webview-layout.ts "app/android/$OUT")
adb logcat -d -s Toosh TooshE2E > "$OUT/logcat.txt" 2>&1 || true
grep -E "step-ok|long SMS|server counts|inbox import|sms STORED|sms NOT_RELEVANT" "$OUT/logcat.txt" || true
echo "Emulator SMS end-to-end: OK"
