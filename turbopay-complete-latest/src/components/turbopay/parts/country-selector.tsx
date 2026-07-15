"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Country {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
}

const ALL_COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan", flag: "\u{1F1E6}\u{1F1EB}", dialCode: "+93" },
  { code: "AL", name: "Albania", flag: "\u{1F1E6}\u{1F1F1}", dialCode: "+355" },
  { code: "DZ", name: "Algeria", flag: "\u{1F1E9}\u{1F1FF}", dialCode: "+213" },
  { code: "AS", name: "American Samoa", flag: "\u{1F1E6}\u{1F1F8}", dialCode: "+1684" },
  { code: "AD", name: "Andorra", flag: "\u{1F1E6}\u{1F1E9}", dialCode: "+376" },
  { code: "AO", name: "Angola", flag: "\u{1F1E6}\u{1F1F4}", dialCode: "+244" },
  { code: "AI", name: "Anguilla", flag: "\u{1F1E6}\u{1F1EE}", dialCode: "+1264" },
  { code: "AQ", name: "Antarctica", flag: "\u{1F1E6}\u{1F1F6}", dialCode: "+672" },
  { code: "AG", name: "Antigua and Barbuda", flag: "\u{1F1E6}\u{1F1EC}", dialCode: "+1268" },
  { code: "AR", name: "Argentina", flag: "\u{1F1E6}\u{1F1F7}", dialCode: "+54" },
  { code: "AM", name: "Armenia", flag: "\u{1F1E6}\u{1F1F2}", dialCode: "+374" },
  { code: "AW", name: "Aruba", flag: "\u{1F1E6}\u{1F1FC}", dialCode: "+297" },
  { code: "AU", name: "Australia", flag: "\u{1F1E6}\u{1F1FA}", dialCode: "+61" },
  { code: "AT", name: "Austria", flag: "\u{1F1E6}\u{1F1F9}", dialCode: "+43" },
  { code: "AZ", name: "Azerbaijan", flag: "\u{1F1E6}\u{1F1FF}", dialCode: "+994" },
  { code: "BS", name: "Bahamas", flag: "\u{1F1E7}\u{1F1F8}", dialCode: "+1242" },
  { code: "BH", name: "Bahrain", flag: "\u{1F1E7}\u{1F1ED}", dialCode: "+973" },
  { code: "BD", name: "Bangladesh", flag: "\u{1F1E7}\u{1F1E9}", dialCode: "+880" },
  { code: "BB", name: "Barbados", flag: "\u{1F1E7}\u{1F1E7}", dialCode: "+1246" },
  { code: "BY", name: "Belarus", flag: "\u{1F1E7}\u{1F1FE}", dialCode: "+375" },
  { code: "BE", name: "Belgium", flag: "\u{1F1E7}\u{1F1EA}", dialCode: "+32" },
  { code: "BZ", name: "Belize", flag: "\u{1F1E7}\u{1F1FF}", dialCode: "+501" },
  { code: "BJ", name: "Benin", flag: "\u{1F1E7}\u{1F1EF}", dialCode: "+229" },
  { code: "BM", name: "Bermuda", flag: "\u{1F1E7}\u{1F1F2}", dialCode: "+1441" },
  { code: "BT", name: "Bhutan", flag: "\u{1F1E7}\u{1F1F9}", dialCode: "+975" },
  { code: "BO", name: "Bolivia", flag: "\u{1F1E7}\u{1F1F4}", dialCode: "+591" },
  { code: "BA", name: "Bosnia and Herzegovina", flag: "\u{1F1E7}\u{1F1E6}", dialCode: "+387" },
  { code: "BW", name: "Botswana", flag: "\u{1F1E7}\u{1F1FC}", dialCode: "+267" },
  { code: "BR", name: "Brazil", flag: "\u{1F1E7}\u{1F1F7}", dialCode: "+55" },
  { code: "IO", name: "British Indian Ocean Territory", flag: "\u{1F1EE}\u{1F1F4}", dialCode: "+246" },
  { code: "BN", name: "Brunei", flag: "\u{1F1E7}\u{1F1F3}", dialCode: "+673" },
  { code: "BG", name: "Bulgaria", flag: "\u{1F1E7}\u{1F1EC}", dialCode: "+359" },
  { code: "BF", name: "Burkina Faso", flag: "\u{1F1E7}\u{1F1EB}", dialCode: "+226" },
  { code: "BI", name: "Burundi", flag: "\u{1F1E7}\u{1F1EE}", dialCode: "+257" },
  { code: "CV", name: "Cabo Verde", flag: "\u{1F1E8}\u{1F1FB}", dialCode: "+238" },
  { code: "KH", name: "Cambodia", flag: "\u{1F1F0}\u{1F1ED}", dialCode: "+855" },
  { code: "CM", name: "Cameroon", flag: "\u{1F1E8}\u{1F1F2}", dialCode: "+237" },
  { code: "CA", name: "Canada", flag: "\u{1F1E8}\u{1F1E6}", dialCode: "+1" },
  { code: "KY", name: "Cayman Islands", flag: "\u{1F1F0}\u{1F1FE}", dialCode: "+1345" },
  { code: "CF", name: "Central African Republic", flag: "\u{1F1E8}\u{1F1EB}", dialCode: "+236" },
  { code: "TD", name: "Chad", flag: "\u{1F1F9}\u{1F1E9}", dialCode: "+235" },
  { code: "CL", name: "Chile", flag: "\u{1F1E8}\u{1F1F1}", dialCode: "+56" },
  { code: "CN", name: "China", flag: "\u{1F1E8}\u{1F1F3}", dialCode: "+86" },
  { code: "CO", name: "Colombia", flag: "\u{1F1E8}\u{1F1F4}", dialCode: "+57" },
  { code: "KM", name: "Comoros", flag: "\u{1F1F0}\u{1F1F2}", dialCode: "+269" },
  { code: "CG", name: "Congo", flag: "\u{1F1E8}\u{1F1EC}", dialCode: "+242" },
  { code: "CD", name: "Congo (DRC)", flag: "\u{1F1E8}\u{1F1E9}", dialCode: "+243" },
  { code: "CK", name: "Cook Islands", flag: "\u{1F1E8}\u{1F1F0}", dialCode: "+682" },
  { code: "CR", name: "Costa Rica", flag: "\u{1F1E8}\u{1F1F7}", dialCode: "+506" },
  { code: "CI", name: "Cote d'Ivoire", flag: "\u{1F1E8}\u{1F1EE}", dialCode: "+225" },
  { code: "HR", name: "Croatia", flag: "\u{1F1ED}\u{1F1F7}", dialCode: "+385" },
  { code: "CU", name: "Cuba", flag: "\u{1F1E8}\u{1F1FA}", dialCode: "+53" },
  { code: "CW", name: "Curacao", flag: "\u{1F1E8}\u{1F1FC}", dialCode: "+599" },
  { code: "CY", name: "Cyprus", flag: "\u{1F1E8}\u{1F1FE}", dialCode: "+357" },
  { code: "CZ", name: "Czech Republic", flag: "\u{1F1E8}\u{1F1FF}", dialCode: "+420" },
  { code: "DK", name: "Denmark", flag: "\u{1F1E9}\u{1F1F0}", dialCode: "+45" },
  { code: "DJ", name: "Djibouti", flag: "\u{1F1E9}\u{1F1EF}", dialCode: "+253" },
  { code: "DM", name: "Dominica", flag: "\u{1F1E9}\u{1F1F2}", dialCode: "+1767" },
  { code: "DO", name: "Dominican Republic", flag: "\u{1F1E9}\u{1F1F4}", dialCode: "+1809" },
  { code: "EC", name: "Ecuador", flag: "\u{1F1EA}\u{1F1E8}", dialCode: "+593" },
  { code: "EG", name: "Egypt", flag: "\u{1F1EA}\u{1F1EC}", dialCode: "+20" },
  { code: "SV", name: "El Salvador", flag: "\u{1F1F8}\u{1F1FB}", dialCode: "+503" },
  { code: "GQ", name: "Equatorial Guinea", flag: "\u{1F1EC}\u{1F1F6}", dialCode: "+240" },
  { code: "ER", name: "Eritrea", flag: "\u{1F1EA}\u{1F1F7}", dialCode: "+291" },
  { code: "EE", name: "Estonia", flag: "\u{1F1EA}\u{1F1EA}", dialCode: "+372" },
  { code: "SZ", name: "Eswatini", flag: "\u{1F1F8}\u{1F1FF}", dialCode: "+268" },
  { code: "ET", name: "Ethiopia", flag: "\u{1F1EA}\u{1F1F9}", dialCode: "+251" },
  { code: "FK", name: "Falkland Islands", flag: "\u{1F1EB}\u{1F1F0}", dialCode: "+500" },
  { code: "FO", name: "Faroe Islands", flag: "\u{1F1EB}\u{1F1F4}", dialCode: "+298" },
  { code: "FJ", name: "Fiji", flag: "\u{1F1EB}\u{1F1EF}", dialCode: "+679" },
  { code: "FI", name: "Finland", flag: "\u{1F1EB}\u{1F1EE}", dialCode: "+358" },
  { code: "FR", name: "France", flag: "\u{1F1EB}\u{1F1F7}", dialCode: "+33" },
  { code: "GF", name: "French Guiana", flag: "\u{1F1EB}\u{1F1F7}", dialCode: "+594" },
  { code: "PF", name: "French Polynesia", flag: "\u{1F1F5}\u{1F1EB}", dialCode: "+689" },
  { code: "GA", name: "Gabon", flag: "\u{1F1EC}\u{1F1E6}", dialCode: "+241" },
  { code: "GM", name: "Gambia", flag: "\u{1F1EC}\u{1F1F2}", dialCode: "+220" },
  { code: "GE", name: "Georgia", flag: "\u{1F1EC}\u{1F1EA}", dialCode: "+995" },
  { code: "DE", name: "Germany", flag: "\u{1F1E9}\u{1F1EA}", dialCode: "+49" },
  { code: "GH", name: "Ghana", flag: "\u{1F1EC}\u{1F1ED}", dialCode: "+233" },
  { code: "GI", name: "Gibraltar", flag: "\u{1F1EC}\u{1F1EE}", dialCode: "+350" },
  { code: "GR", name: "Greece", flag: "\u{1F1EC}\u{1F1F7}", dialCode: "+30" },
  { code: "GL", name: "Greenland", flag: "\u{1F1EC}\u{1F1F1}", dialCode: "+299" },
  { code: "GD", name: "Grenada", flag: "\u{1F1EC}\u{1F1E9}", dialCode: "+1473" },
  { code: "GP", name: "Guadeloupe", flag: "\u{1F1EC}\u{1F1F5}", dialCode: "+590" },
  { code: "GU", name: "Guam", flag: "\u{1F1EC}\u{1F1FA}", dialCode: "+1671" },
  { code: "GT", name: "Guatemala", flag: "\u{1F1EC}\u{1F1F9}", dialCode: "+502" },
  { code: "GG", name: "Guernsey", flag: "\u{1F1EC}\u{1F1EC}", dialCode: "+44" },
  { code: "GN", name: "Guinea", flag: "\u{1F1EC}\u{1F1F3}", dialCode: "+224" },
  { code: "GW", name: "Guinea-Bissau", flag: "\u{1F1EC}\u{1F1FC}", dialCode: "+245" },
  { code: "GY", name: "Guyana", flag: "\u{1F1EC}\u{1F1FE}", dialCode: "+592" },
  { code: "HT", name: "Haiti", flag: "\u{1F1ED}\u{1F1F9}", dialCode: "+509" },
  { code: "HN", name: "Honduras", flag: "\u{1F1ED}\u{1F1F3}", dialCode: "+504" },
  { code: "HK", name: "Hong Kong", flag: "\u{1F1ED}\u{1F1F0}", dialCode: "+852" },
  { code: "HU", name: "Hungary", flag: "\u{1F1ED}\u{1F1FA}", dialCode: "+36" },
  { code: "IS", name: "Iceland", flag: "\u{1F1EE}\u{1F1F8}", dialCode: "+354" },
  { code: "IN", name: "India", flag: "\u{1F1EE}\u{1F1F3}", dialCode: "+91" },
  { code: "ID", name: "Indonesia", flag: "\u{1F1EE}\u{1F1E9}", dialCode: "+62" },
  { code: "IR", name: "Iran", flag: "\u{1F1EE}\u{1F1F7}", dialCode: "+98" },
  { code: "IQ", name: "Iraq", flag: "\u{1F1EE}\u{1F1F6}", dialCode: "+964" },
  { code: "IE", name: "Ireland", flag: "\u{1F1EE}\u{1F1EA}", dialCode: "+353" },
  { code: "IM", name: "Isle of Man", flag: "\u{1F1EE}\u{1F1F2}", dialCode: "+44" },
  { code: "IL", name: "Israel", flag: "\u{1F1EE}\u{1F1F1}", dialCode: "+972" },
  { code: "IT", name: "Italy", flag: "\u{1F1EE}\u{1F1F9}", dialCode: "+39" },
  { code: "JM", name: "Jamaica", flag: "\u{1F1EF}\u{1F1F2}", dialCode: "+1876" },
  { code: "JP", name: "Japan", flag: "\u{1F1EF}\u{1F1F5}", dialCode: "+81" },
  { code: "JE", name: "Jersey", flag: "\u{1F1EF}\u{1F1EA}", dialCode: "+44" },
  { code: "JO", name: "Jordan", flag: "\u{1F1EF}\u{1F1F4}", dialCode: "+962" },
  { code: "KZ", name: "Kazakhstan", flag: "\u{1F1F0}\u{1F1FF}", dialCode: "+7" },
  { code: "KE", name: "Kenya", flag: "\u{1F1F0}\u{1F1EA}", dialCode: "+254" },
  { code: "KI", name: "Kiribati", flag: "\u{1F1F0}\u{1F1EE}", dialCode: "+686" },
  { code: "KP", name: "North Korea", flag: "\u{1F1F0}\u{1F1F5}", dialCode: "+850" },
  { code: "KR", name: "South Korea", flag: "\u{1F1F0}\u{1F1F7}", dialCode: "+82" },
  { code: "KW", name: "Kuwait", flag: "\u{1F1F0}\u{1F1FC}", dialCode: "+965" },
  { code: "KG", name: "Kyrgyzstan", flag: "\u{1F1F0}\u{1F1EC}", dialCode: "+996" },
  { code: "LA", name: "Laos", flag: "\u{1F1F1}\u{1F1E6}", dialCode: "+856" },
  { code: "LV", name: "Latvia", flag: "\u{1F1F1}\u{1F1FB}", dialCode: "+371" },
  { code: "LB", name: "Lebanon", flag: "\u{1F1F1}\u{1F1E7}", dialCode: "+961" },
  { code: "LS", name: "Lesotho", flag: "\u{1F1F1}\u{1F1F8}", dialCode: "+266" },
  { code: "LR", name: "Liberia", flag: "\u{1F1F1}\u{1F1F7}", dialCode: "+231" },
  { code: "LY", name: "Libya", flag: "\u{1F1F1}\u{1F1FE}", dialCode: "+218" },
  { code: "LI", name: "Liechtenstein", flag: "\u{1F1F1}\u{1F1EE}", dialCode: "+423" },
  { code: "LT", name: "Lithuania", flag: "\u{1F1F1}\u{1F1F9}", dialCode: "+370" },
  { code: "LU", name: "Luxembourg", flag: "\u{1F1F1}\u{1F1FA}", dialCode: "+352" },
  { code: "MO", name: "Macao", flag: "\u{1F1F2}\u{1F1F4}", dialCode: "+853" },
  { code: "MG", name: "Madagascar", flag: "\u{1F1F2}\u{1F1EC}", dialCode: "+261" },
  { code: "MW", name: "Malawi", flag: "\u{1F1F2}\u{1F1FC}", dialCode: "+265" },
  { code: "MY", name: "Malaysia", flag: "\u{1F1F2}\u{1F1FE}", dialCode: "+60" },
  { code: "MV", name: "Maldives", flag: "\u{1F1F2}\u{1F1FB}", dialCode: "+960" },
  { code: "ML", name: "Mali", flag: "\u{1F1F2}\u{1F1F1}", dialCode: "+223" },
  { code: "MT", name: "Malta", flag: "\u{1F1F2}\u{1F1F9}", dialCode: "+356" },
  { code: "MH", name: "Marshall Islands", flag: "\u{1F1F2}\u{1F1ED}", dialCode: "+692" },
  { code: "MQ", name: "Martinique", flag: "\u{1F1F2}\u{1F1F6}", dialCode: "+596" },
  { code: "MR", name: "Mauritania", flag: "\u{1F1F2}\u{1F1F7}", dialCode: "+222" },
  { code: "MU", name: "Mauritius", flag: "\u{1F1F2}\u{1F1FA}", dialCode: "+230" },
  { code: "YT", name: "Mayotte", flag: "\u{1F1FE}\u{1F1F9}", dialCode: "+262" },
  { code: "MX", name: "Mexico", flag: "\u{1F1F2}\u{1F1FD}", dialCode: "+52" },
  { code: "FM", name: "Micronesia", flag: "\u{1F1EB}\u{1F1F2}", dialCode: "+691" },
  { code: "MD", name: "Moldova", flag: "\u{1F1F2}\u{1F1E9}", dialCode: "+373" },
  { code: "MC", name: "Monaco", flag: "\u{1F1F2}\u{1F1E8}", dialCode: "+377" },
  { code: "MN", name: "Mongolia", flag: "\u{1F1F2}\u{1F1F3}", dialCode: "+976" },
  { code: "ME", name: "Montenegro", flag: "\u{1F1F2}\u{1F1EA}", dialCode: "+382" },
  { code: "MS", name: "Montserrat", flag: "\u{1F1F2}\u{1F1F8}", dialCode: "+1664" },
  { code: "MA", name: "Morocco", flag: "\u{1F1F2}\u{1F1E6}", dialCode: "+212" },
  { code: "MZ", name: "Mozambique", flag: "\u{1F1F2}\u{1F1FF}", dialCode: "+258" },
  { code: "MM", name: "Myanmar", flag: "\u{1F1F2}\u{1F1F2}", dialCode: "+95" },
  { code: "NA", name: "Namibia", flag: "\u{1F1F3}\u{1F1E6}", dialCode: "+264" },
  { code: "NR", name: "Nauru", flag: "\u{1F1F3}\u{1F1F7}", dialCode: "+674" },
  { code: "NP", name: "Nepal", flag: "\u{1F1F3}\u{1F1F5}", dialCode: "+977" },
  { code: "NL", name: "Netherlands", flag: "\u{1F1F3}\u{1F1F1}", dialCode: "+31" },
  { code: "NC", name: "New Caledonia", flag: "\u{1F1F3}\u{1F1E8}", dialCode: "+687" },
  { code: "NZ", name: "New Zealand", flag: "\u{1F1F3}\u{1F1FF}", dialCode: "+64" },
  { code: "NI", name: "Nicaragua", flag: "\u{1F1F3}\u{1F1EE}", dialCode: "+505" },
  { code: "NE", name: "Niger", flag: "\u{1F1F3}\u{1F1EA}", dialCode: "+227" },
  { code: "NG", name: "Nigeria", flag: "\u{1F1F3}\u{1F1EC}", dialCode: "+234" },
  { code: "NU", name: "Niue", flag: "\u{1F1F3}\u{1F1FA}", dialCode: "+683" },
  { code: "NF", name: "Norfolk Island", flag: "\u{1F1F3}\u{1F1EB}", dialCode: "+672" },
  { code: "MP", name: "Northern Mariana Islands", flag: "\u{1F1F2}\u{1F1F5}", dialCode: "+1670" },
  { code: "NO", name: "Norway", flag: "\u{1F1F3}\u{1F1F4}", dialCode: "+47" },
  { code: "OM", name: "Oman", flag: "\u{1F1F4}\u{1F1F2}", dialCode: "+968" },
  { code: "PK", name: "Pakistan", flag: "\u{1F1F5}\u{1F1F0}", dialCode: "+92" },
  { code: "PW", name: "Palau", flag: "\u{1F1F5}\u{1F1FC}", dialCode: "+680" },
  { code: "PS", name: "Palestine", flag: "\u{1F1F5}\u{1F1F8}", dialCode: "+970" },
  { code: "PA", name: "Panama", flag: "\u{1F1F5}\u{1F1E6}", dialCode: "+507" },
  { code: "PG", name: "Papua New Guinea", flag: "\u{1F1F5}\u{1F1EC}", dialCode: "+675" },
  { code: "PY", name: "Paraguay", flag: "\u{1F1F5}\u{1F1FE}", dialCode: "+595" },
  { code: "PE", name: "Peru", flag: "\u{1F1F5}\u{1F1EA}", dialCode: "+51" },
  { code: "PH", name: "Philippines", flag: "\u{1F1F5}\u{1F1ED}", dialCode: "+63" },
  { code: "PN", name: "Pitcairn Islands", flag: "\u{1F1F5}\u{1F1F3}", dialCode: "+64" },
  { code: "PL", name: "Poland", flag: "\u{1F1F5}\u{1F1F1}", dialCode: "+48" },
  { code: "PT", name: "Portugal", flag: "\u{1F1F5}\u{1F1F9}", dialCode: "+351" },
  { code: "PR", name: "Puerto Rico", flag: "\u{1F1F5}\u{1F1F7}", dialCode: "+1787" },
  { code: "QA", name: "Qatar", flag: "\u{1F1F6}\u{1F1E6}", dialCode: "+974" },
  { code: "RE", name: "Reunion", flag: "\u{1F1F7}\u{1F1EA}", dialCode: "+262" },
  { code: "RO", name: "Romania", flag: "\u{1F1F7}\u{1F1F4}", dialCode: "+40" },
  { code: "RU", name: "Russia", flag: "\u{1F1F7}\u{1F1FA}", dialCode: "+7" },
  { code: "RW", name: "Rwanda", flag: "\u{1F1F7}\u{1F1FC}", dialCode: "+250" },
  { code: "BL", name: "Saint Barthelemy", flag: "\u{1F1E7}\u{1F1F1}", dialCode: "+590" },
  { code: "SH", name: "Saint Helena", flag: "\u{1F1F8}\u{1F1ED}", dialCode: "+290" },
  { code: "KN", name: "Saint Kitts and Nevis", flag: "\u{1F1F0}\u{1F1F3}", dialCode: "+1869" },
  { code: "LC", name: "Saint Lucia", flag: "\u{1F1F1}\u{1F1E8}", dialCode: "+1758" },
  { code: "MF", name: "Saint Martin", flag: "\u{1F1F2}\u{1F1EB}", dialCode: "+590" },
  { code: "PM", name: "Saint Pierre and Miquelon", flag: "\u{1F1F5}\u{1F1F2}", dialCode: "+508" },
  { code: "VC", name: "Saint Vincent and the Grenadines", flag: "\u{1F1FB}\u{1F1E8}", dialCode: "+1784" },
  { code: "WS", name: "Samoa", flag: "\u{1F1FC}\u{1F1F8}", dialCode: "+685" },
  { code: "SM", name: "San Marino", flag: "\u{1F1F8}\u{1F1F2}", dialCode: "+378" },
  { code: "ST", name: "Sao Tome and Principe", flag: "\u{1F1F8}\u{1F1F9}", dialCode: "+239" },
  { code: "SA", name: "Saudi Arabia", flag: "\u{1F1F8}\u{1F1E6}", dialCode: "+966" },
  { code: "SN", name: "Senegal", flag: "\u{1F1F8}\u{1F1F3}", dialCode: "+221" },
  { code: "RS", name: "Serbia", flag: "\u{1F1F7}\u{1F1F8}", dialCode: "+381" },
  { code: "SC", name: "Seychelles", flag: "\u{1F1F8}\u{1F1E8}", dialCode: "+248" },
  { code: "SL", name: "Sierra Leone", flag: "\u{1F1F8}\u{1F1F1}", dialCode: "+232" },
  { code: "SG", name: "Singapore", flag: "\u{1F1F8}\u{1F1EC}", dialCode: "+65" },
  { code: "SX", name: "Sint Maarten", flag: "\u{1F1F8}\u{1F1FD}", dialCode: "+1721" },
  { code: "SK", name: "Slovakia", flag: "\u{1F1F8}\u{1F1F0}", dialCode: "+421" },
  { code: "SI", name: "Slovenia", flag: "\u{1F1F8}\u{1F1EE}", dialCode: "+386" },
  { code: "SB", name: "Solomon Islands", flag: "\u{1F1F8}\u{1F1E7}", dialCode: "+677" },
  { code: "SO", name: "Somalia", flag: "\u{1F1F8}\u{1F1F4}", dialCode: "+252" },
  { code: "ZA", name: "South Africa", flag: "\u{1F1FF}\u{1F1E6}", dialCode: "+27" },
  { code: "GS", name: "South Georgia and the South Sandwich Islands", flag: "\u{1F1EC}\u{1F1F8}", dialCode: "+500" },
  { code: "SS", name: "South Sudan", flag: "\u{1F1F8}\u{1F1F8}", dialCode: "+211" },
  { code: "ES", name: "Spain", flag: "\u{1F1EA}\u{1F1F8}", dialCode: "+34" },
  { code: "LK", name: "Sri Lanka", flag: "\u{1F1F1}\u{1F1F0}", dialCode: "+94" },
  { code: "SD", name: "Sudan", flag: "\u{1F1F8}\u{1F1E9}", dialCode: "+249" },
  { code: "SR", name: "Suriname", flag: "\u{1F1F8}\u{1F1F7}", dialCode: "+597" },
  { code: "SJ", name: "Svalbard and Jan Mayen", flag: "\u{1F1F8}\u{1F1EF}", dialCode: "+47" },
  { code: "SE", name: "Sweden", flag: "\u{1F1F8}\u{1F1EA}", dialCode: "+46" },
  { code: "CH", name: "Switzerland", flag: "\u{1F1E8}\u{1F1ED}", dialCode: "+41" },
  { code: "SY", name: "Syria", flag: "\u{1F1F8}\u{1F1FE}", dialCode: "+963" },
  { code: "TW", name: "Taiwan", flag: "\u{1F1F9}\u{1F1FC}", dialCode: "+886" },
  { code: "TJ", name: "Tajikistan", flag: "\u{1F1F9}\u{1F1EF}", dialCode: "+992" },
  { code: "TZ", name: "Tanzania", flag: "\u{1F1F9}\u{1F1FF}", dialCode: "+255" },
  { code: "TH", name: "Thailand", flag: "\u{1F1F9}\u{1F1ED}", dialCode: "+66" },
  { code: "TL", name: "Timor-Leste", flag: "\u{1F1F9}\u{1F1F1}", dialCode: "+670" },
  { code: "TG", name: "Togo", flag: "\u{1F1F9}\u{1F1EC}", dialCode: "+228" },
  { code: "TK", name: "Tokelau", flag: "\u{1F1F9}\u{1F1F0}", dialCode: "+690" },
  { code: "TO", name: "Tonga", flag: "\u{1F1F9}\u{1F1F4}", dialCode: "+676" },
  { code: "TT", name: "Trinidad and Tobago", flag: "\u{1F1F9}\u{1F1F9}", dialCode: "+1868" },
  { code: "TN", name: "Tunisia", flag: "\u{1F1F9}\u{1F1F3}", dialCode: "+216" },
  { code: "TR", name: "Turkey", flag: "\u{1F1F9}\u{1F1F7}", dialCode: "+90" },
  { code: "TM", name: "Turkmenistan", flag: "\u{1F1F9}\u{1F1F2}", dialCode: "+993" },
  { code: "TC", name: "Turks and Caicos Islands", flag: "\u{1F1F9}\u{1F1E8}", dialCode: "+1649" },
  { code: "TV", name: "Tuvalu", flag: "\u{1F1F9}\u{1F1FB}", dialCode: "+688" },
  { code: "UG", name: "Uganda", flag: "\u{1F1FA}\u{1F1EC}", dialCode: "+256" },
  { code: "UA", name: "Ukraine", flag: "\u{1F1FA}\u{1F1E6}", dialCode: "+380" },
  { code: "AE", name: "United Arab Emirates", flag: "\u{1F1E6}\u{1F1EA}", dialCode: "+971" },
  { code: "GB", name: "United Kingdom", flag: "\u{1F1EC}\u{1F1E7}", dialCode: "+44" },
  { code: "US", name: "United States", flag: "\u{1F1FA}\u{1F1F8}", dialCode: "+1" },
  { code: "UY", name: "Uruguay", flag: "\u{1F1FA}\u{1F1FE}", dialCode: "+598" },
  { code: "UZ", name: "Uzbekistan", flag: "\u{1F1FA}\u{1F1FF}", dialCode: "+998" },
  { code: "VU", name: "Vanuatu", flag: "\u{1F1FB}\u{1F1FA}", dialCode: "+678" },
  { code: "VA", name: "Vatican City", flag: "\u{1F1FB}\u{1F1E6}", dialCode: "+379" },
  { code: "VE", name: "Venezuela", flag: "\u{1F1FB}\u{1F1EA}", dialCode: "+58" },
  { code: "VN", name: "Vietnam", flag: "\u{1F1FB}\u{1F1F3}", dialCode: "+84" },
  { code: "VG", name: "British Virgin Islands", flag: "\u{1F1FB}\u{1F1EC}", dialCode: "+1284" },
  { code: "VI", name: "US Virgin Islands", flag: "\u{1F1FB}\u{1F1EE}", dialCode: "+1340" },
  { code: "WF", name: "Wallis and Futuna", flag: "\u{1F1FC}\u{1F1EB}", dialCode: "+681" },
  { code: "EH", name: "Western Sahara", flag: "\u{1F1EA}\u{1F1ED}", dialCode: "+212" },
  { code: "YE", name: "Yemen", flag: "\u{1F1FE}\u{1F1EA}", dialCode: "+967" },
  { code: "ZM", name: "Zambia", flag: "\u{1F1FF}\u{1F1F2}", dialCode: "+260" },
  { code: "ZW", name: "Zimbabwe", flag: "\u{1F1FF}\u{1F1FC}", dialCode: "+263" },
];

interface CountrySelectorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CountrySelector({ value, onChange, placeholder = "Select country", disabled }: CountrySelectorProps) {
  const [open, setOpen] = React.useState(false);
  const selected = ALL_COUNTRIES.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          {selected ? (
            <span className="flex items-center gap-2">
              <span className="text-base leading-none">{selected.flag}</span>
              <span>{selected.name}</span>
              <span className="text-muted-foreground text-xs">({selected.code})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search countries..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-y-auto">
              {ALL_COUNTRIES.map((country) => (
                <CommandItem
                  key={country.code}
                  value={`${country.name} ${country.code} ${country.dialCode}`}
                  onSelect={() => {
                    onChange(country.code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === country.code ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="text-base leading-none mr-2">{country.flag}</span>
                  <span>{country.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{country.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { ALL_COUNTRIES };
