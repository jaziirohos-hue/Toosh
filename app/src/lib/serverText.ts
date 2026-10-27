/**
 * The server writes its messages in Somali. When the app is in English, known messages (the main error message and
 * field errors) are shown in English instead. Anything not listed is shown as the server wrote it.
 */
import { getLanguage } from './i18n.ts';

const EN: Record<string, string> = {
  // General
  'Adeeggu hadda ma shaqeynayo. Isku day mar kale.': 'The service is not available right now. Try again.',
  'Isku day mar dambe.': 'Too many requests. Try again later.',
  'Codsi aan sax ahayn.': 'Invalid request.',
  'Codsi aan la oggolayn.': 'Request not allowed.',
  'Codsigu ma guuleysan. Isku day mar kale.': 'The request failed. Try again.',
  'Bogga xiga lama heli karo.': 'The next page could not be loaded.',
  'Shaandheyn aan sax ahayn.': 'Invalid filter.',
  'Muddo aan sax ahayn.': 'Invalid period.',
  'Hubi xogta foomka.': 'Check the form.',
  'Hubi xogta.': 'Check the details.',
  // Sign-in and account
  'Fadlan gal akoonkaaga.': 'Please sign in.',
  'Aaladdan waa laga saaray akoonka ama fadhigu wuu dhacay. Fadlan dib u gal.': 'This device was removed from the account or the session ended. Please sign in again.',
  'Lambarka ama furaha sirta ah waa khalad.': 'Wrong number or password.',
  'Isku dayo badan. Sug 15 daqiiqo kadib isku day.': 'Too many attempts. Wait 15 minutes and try again.',
  'Lambarkan akoon ayaa horay loogu sameeyay. Isticmaal "Gal Akoonka".': 'An account already uses this number. Use "Sign in".',
  'Lambarkan horay ayaa loo diiwaangeliyay.': 'This number is already registered.',
  'Koodku waa khalad ama wuu dhacay.': 'The code is wrong or has expired.',
  'Lambarka ama koodhka soo celinta waa khalad, ama koodhka hore ayaa loo isticmaalay.': 'Wrong number or recovery code, or the code was already used.',
  'Furaha sirta ah ee hadda waa khalad.': 'The current password is wrong.',
  'Dooro furo ka duwan kan hadda.': 'Choose a password different from the current one.',
  'Furaha sirta ah waa inuu ahaadaa ugu yaraan 8 xaraf.': 'The password needs at least 8 characters.',
  'Furaha sirta ah aad buu u dheer yahay.': 'The password is too long.',
  'Geli magacaaga buuxa.': 'Enter your full name.',
  'Geli magacaaga (ilaa 120 xaraf).': 'Enter your name (up to 120 characters).',
  'Geli lambar EVC Plus oo sax ah (sida 61 512 3456).': 'Enter a valid EVC Plus number (e.g. 61 512 3456).',
  'Geli lambar EVC Plus oo sax ah.': 'Enter a valid EVC Plus number.',
  // Devices, numbers, messages
  'Aaladda lama helin.': 'Device not found.',
  'Lambarka lama helin.': 'Number not found.',
  'Fariinta lama helin.': 'Message not found.',
  'Lambar aan sax ahayn.': 'Invalid number.',
  'Hubi lambarka.': 'Check the number.',
  'Magac aan sax ahayn.': 'Invalid name.',
  'Lambarkan horay ayuu ugu jiraa akoonkaaga.': 'This number is already on your account.',
  'Lambarkan taleefan kale ayaa horay u ahaa taleefanka asalka ah.': 'Another phone is already the source phone for this number.',
  'SIM-kan waxaa horay loogu xiray lambar kale.': 'This SIM is already linked to another number.',
  'Kaliya taleefan Android ah ayaa noqon kara taleefanka asalka ah.': 'Only an Android phone can be the source phone.',
  'Tixraacan (reference) horay ayaa loogu diiwaangeliyay dhaqdhaqaaq kale.': 'This reference is already recorded on another transaction.',
  'Fariintan waxaa beddelay aalad kale. Eeg isbeddelka ka hor intaadan kaydin.': 'Another device changed this message. Check the change before saving.',
  'Dooro Soo galay ama Baxay.': 'Choose Received or Sent.',
  'Dooro nooca fariinta.': 'Choose the message type.',
  'Geli qaddarka lacagta.': 'Enter the amount.',
  'Lacagta USD oo keliya ayaa la taageeraa.': 'Only USD is supported.',
  'Lambar Soomaali ah oo sax ah geli (sida 61 599 8822).': 'Enter a valid Somali number (e.g. 61 599 8822).',
  'Nooca kaydka (version) waa khalad.': 'Wrong version.',
  'Taariikh iyo waqti sax ah geli.': 'Enter a valid date and time.',
  'Waqtigu ma noqon karo mustaqbalka.': 'The time cannot be in the future.',
  'Ugu badnaan 3 jajab (sida 54.585).': 'At most 3 decimals (e.g. 54.585).',
  // Expenses, categories, budgets, goals
  'Hubi xogta qarashka.': 'Check the expense details.',
  'Hubi xogta miisaaniyadda.': 'Check the budget details.',
  'Hubi xogta hadafka.': 'Check the goal details.',
  'Qayb aan sax ahayn.': 'Invalid category.',
  'Qaybtan lama helin.': 'This category was not found.',
  'Qayb waxaa la siin karaa lacag baxday oo keliya.': 'Only money sent can have a category.',
  'Qayb magacan leh ayaa horay u jirtay.': 'A category with this name already exists.',
  'Magacan horay ayaa loo isticmaalay.': 'This name is already used.',
  'Geli magaca qaybta (ilaa 40 xaraf).': 'Enter a category name (up to 40 characters).',
  'Dooro calaamad.': 'Choose an icon.',
  'Aalad kale ayaa beddeshay qarashkan. Eeg kan cusub.': 'Another device changed this expense. See the latest version.',
  'Geli magaca qarashka (ilaa 120 xaraf).': 'Enter the expense name (up to 120 characters).',
  'Geli magaca hadafka (ilaa 80 xaraf).': 'Enter the goal name (up to 80 characters).',
  'Geli qaddarka.': 'Enter the amount.',
  'Qaddarku waa inuu noqdaa tiro sida 15.00.': 'The amount must be a number like 15.00.',
  'Ugu badnaan 3 jajab.': 'At most 3 decimals.',
  'Qaddarku aad buu u weyn yahay.': 'The amount is too large.',
  'Qaddarku waa inuu ka weyn yahay 0.': 'The amount must be more than 0.',
  'Dooro lacagta: USD ama SOS.': 'Choose the currency: USD or SOS.',
  'Dooro qaybta qarashka.': 'Choose the expense category.',
  'Geli taariikh sax ah.': 'Enter a valid date.',
  'Taariikhdu ma noqon karto mustaqbalka.': 'The date cannot be in the future.',
  'Taariikh aad u fog.': 'The date is too far back.',
  'Taariikh aan sax ahayn.': 'Invalid date.',
  'Faahfaahintu waa ugu badnaan 500 xaraf.': 'The description is at most 500 characters.',
  'Dooro: la bixiyay ama lama bixin.': 'Choose paid or unpaid.',
  'Dooro muddada: maalin, toddobaad ama bil.': 'Choose the period: day, week or month.',
  'Digniinta waa 1-100%.': 'The warning level is 1-100%.',
  // SIM cards
  'Hubi xogta SIM-ka.': 'Check the SIM card details.',
  'SIM-kan lama helin.': 'This SIM card was not found.',
  'Lambarkan horay ayaa loogu daray SIM Card-yadaada.': 'This number is already in your SIM cards.',
  'Geli magaca SIM-ka (ilaa 60 xaraf).': 'Enter the SIM card name (up to 60 characters).',
  'Geli lambar taleefan Soomaali ah oo sax ah (sida 61 512 3456).': 'Enter a valid Somali phone number (e.g. 61 512 3456).',
  'Dooro shirkadda: Hormuud, Somtel, Golis ama Kale.': 'Choose the network: Hormuud, Somtel, Golis or Other.',
  'Qoraalku waa ugu badnaan 500 xaraf.': 'Notes are at most 500 characters.',
};

/** The server's message in the app's language (English when known, otherwise unchanged). */
export const serverText = (msg: string): string => (getLanguage() === 'en' ? EN[msg] ?? msg : msg);
export function serverDetails<T>(details: T): T {
  if (getLanguage() !== 'en' || !details || typeof details !== 'object') return details;
  return Object.fromEntries(Object.entries(details as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? serverText(v) : v])) as T;
}
