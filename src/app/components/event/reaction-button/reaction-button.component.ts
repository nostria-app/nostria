import { Component, computed, effect, inject, input, output, signal, untracked, viewChild, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import type { Event } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import type { NostrRecord } from '../../../interfaces';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService, RecentEmoji } from '../../../services/account-local-state.service';
import { EventService, ReactionEvents } from '../../../services/event';
import { ReactionService } from '../../../services/reaction.service';
import { LayoutService } from '../../../services/layout.service';
import { EmojiSetService } from '../../../services/emoji-set.service';
import { DataService } from '../../../services/data.service';
import { DatabaseService } from '../../../services/database.service';
import { UserDataService } from '../../../services/user-data.service';
import { LoggerService } from '../../../services/logger.service';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { CustomDialogComponent } from '../../custom-dialog/custom-dialog.component';

// Emoji categories with icons
const EMOJI_CATEGORIES = [
  { id: 'smileys', label: 'Smileys', icon: 'sentiment_satisfied', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'] },
  { id: 'gestures', label: 'Gestures', icon: 'waving_hand', emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄'] },
  { id: 'hearts', label: 'Hearts', icon: 'favorite', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '❤️‍🔥', '❤️‍🩹'] },
  { id: 'animals', label: 'Animals', icon: 'pets', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🪲', '🪳', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔'] },
  { id: 'nature', label: 'Nature', icon: 'eco', emojis: ['🌸', '💮', '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🍀', '☘️', '🍃', '🍂', '🍁', '🪹', '🪺', '🍄', '🌾', '🪻', '🪷', '🌿', '🪨', '🌍', '🌎', '🌏', '🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌙', '🌚', '🌛', '🌜', '☀️', '🌝', '🌞', '⭐', '🌟', '🌠', '☁️', '⛅', '⛈️', '🌤️', '🌥️', '🌦️', '🌧️', '🌨️', '🌩️', '🌪️', '🌫️', '🌬️', '🌈', '☂️', '☔', '⚡', '❄️', '☃️', '⛄', '🔥', '💧', '🌊', '✨', '💫'] },
  { id: 'food', label: 'Food', icon: 'restaurant', emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊'] },
  { id: 'activities', label: 'Activities', icon: 'sports_soccer', emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '⛹️', '🏊', '🚣', '🧗', '🚴', '🚵', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'] },
  { id: 'travel', label: 'Travel', icon: 'flight', emojis: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🪝', '⛽', '🚧', '🚦', '🚥', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🕍', '🛕', '🕋', '⛩️', '🛤️', '🛣️', '🗾', '🎑', '🏞️', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁'] },
  { id: 'objects', label: 'Objects', icon: 'lightbulb', emojis: ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🪆', '🖼️', '🪞', '🪟', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🪅', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '🪧', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓'] },
  { id: 'symbols', label: 'Symbols', icon: 'emoji_symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '🟰', '♾️', '💲', '💱', '™️', '©️', '®️', '👁️‍🗨️', '🔚', '🔙', '🔛', '🔝', '🔜', '〰️', '➰', '➿', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'] },
  { id: 'flags', label: 'Flags', icon: 'flag', emojis: ['🏳️', '🏴', '🏴‍☠️', '🏁', '🚩', '🎌', '🏳️‍🌈', '🏳️‍⚧️', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇩🇪', '🇫🇷', '🇪🇸', '🇮🇹', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇲🇽', '🇷🇺', '🇿🇦', '🇳🇬', '🇪🇬', '🇦🇷', '🇨🇱', '🇨🇴', '🇵🇪', '🇻🇪', '🇵🇱', '🇳🇱', '🇧🇪', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇮🇪', '🇵🇹', '🇬🇷', '🇹🇷', '🇸🇦', '🇦🇪', '🇮🇱', '🇹🇭', '🇻🇳', '🇵🇭', '🇮🇩', '🇲🇾', '🇸🇬', '🇳🇿', '🇨🇭', '🇦🇹', '🇭🇺', '🇨🇿', '🇷🇴', '🇺🇦', '🇭🇷', '🇷🇸', '🇧🇬', '🇸🇰', '🇸🇮'] }
];

// Keyword-based emoji search map
const EMOJI_KEYWORDS: Record<string, string[]> = {
  // Smileys
  '😀': ['grin', 'happy', 'smile', 'face'],
  '😃': ['smile', 'happy', 'grin', 'face', 'open'],
  '😄': ['smile', 'happy', 'grin', 'face', 'eyes'],
  '😁': ['grin', 'teeth', 'happy', 'beam'],
  '😆': ['laugh', 'satisfied', 'xd', 'squint'],
  '😅': ['sweat', 'nervous', 'laugh', 'relief'],
  '🤣': ['rofl', 'rolling', 'laugh', 'lol', 'lmao'],
  '😂': ['laugh', 'cry', 'tears', 'joy', 'lol', 'funny'],
  '🙂': ['smile', 'slight', 'face'],
  '😊': ['blush', 'smile', 'happy', 'pleased'],
  '😇': ['angel', 'innocent', 'halo', 'blessed'],
  '🥰': ['love', 'hearts', 'adore', 'affection'],
  '😍': ['love', 'heart', 'eyes', 'crush', 'adore'],
  '🤩': ['star', 'eyes', 'excited', 'starstruck', 'wow'],
  '😘': ['kiss', 'love', 'heart', 'blow'],
  '😋': ['yummy', 'delicious', 'tongue', 'tasty', 'food'],
  '😛': ['tongue', 'playful', 'silly'],
  '😜': ['wink', 'tongue', 'playful', 'crazy', 'silly'],
  '🤪': ['crazy', 'zany', 'wild', 'goofy', 'silly'],
  '😝': ['tongue', 'squint', 'playful', 'silly'],
  '🤑': ['money', 'rich', 'dollar', 'greedy'],
  '🤗': ['hug', 'hugging', 'embrace', 'open', 'arms'],
  '🤔': ['think', 'thinking', 'hmm', 'consider', 'ponder'],
  '🤐': ['zip', 'mouth', 'secret', 'quiet', 'silent'],
  '🤨': ['raised', 'eyebrow', 'skeptical', 'suspicious'],
  '😐': ['neutral', 'meh', 'blank', 'expressionless'],
  '😑': ['expressionless', 'blank', 'meh', 'unamused'],
  '😶': ['silent', 'mute', 'speechless', 'no', 'mouth'],
  '😏': ['smirk', 'smug', 'sly', 'suggestive'],
  '😒': ['unamused', 'side', 'eye', 'meh', 'annoyed'],
  '🙄': ['eye', 'roll', 'annoyed', 'frustrated', 'whatever'],
  '😬': ['grimace', 'awkward', 'nervous', 'cringe'],
  '😌': ['relieved', 'content', 'peaceful', 'calm'],
  '😔': ['sad', 'pensive', 'disappointed', 'down'],
  '😪': ['sleepy', 'tired', 'sleep', 'drowsy'],
  '🤤': ['drool', 'drooling', 'hungry', 'want', 'desire'],
  '😴': ['sleep', 'sleeping', 'zzz', 'tired', 'snore'],
  '😷': ['mask', 'sick', 'medical', 'covid', 'flu'],
  '🤒': ['sick', 'thermometer', 'fever', 'ill'],
  '🤕': ['hurt', 'injured', 'bandage', 'head'],
  '🤢': ['sick', 'nauseous', 'green', 'queasy'],
  '🤮': ['vomit', 'sick', 'throw', 'up', 'puke'],
  '🤧': ['sneeze', 'sick', 'tissue', 'cold', 'allergies'],
  '🥵': ['hot', 'heat', 'sweating', 'fever', 'overheated'],
  '🥶': ['cold', 'freezing', 'frozen', 'ice', 'winter'],
  '🥴': ['drunk', 'woozy', 'dizzy', 'tipsy', 'intoxicated'],
  '😵': ['dizzy', 'dead', 'knocked', 'out', 'spiral'],
  '🤯': ['mind', 'blown', 'explode', 'shocked', 'wow'],
  '🤠': ['cowboy', 'western', 'yeehaw', 'hat'],
  '🥳': ['party', 'celebration', 'birthday', 'celebrate', 'woohoo'],
  '😎': ['cool', 'sunglasses', 'awesome', 'chill'],
  '🤓': ['nerd', 'geek', 'glasses', 'smart'],
  '🧐': ['monocle', 'fancy', 'investigate', 'curious'],
  // Gestures
  '👍': ['thumbs', 'up', 'like', 'approve', 'yes', 'good', 'ok', 'okay'],
  '👎': ['thumbs', 'down', 'dislike', 'disapprove', 'no', 'bad'],
  '👋': ['wave', 'hi', 'hello', 'bye', 'goodbye', 'hand'],
  '👏': ['clap', 'applause', 'bravo', 'congrats', 'praise'],
  '🙌': ['raise', 'hands', 'hooray', 'celebration', 'praise'],
  '🤝': ['handshake', 'deal', 'agreement', 'partnership'],
  '🙏': ['pray', 'please', 'thanks', 'namaste', 'hope', 'wish'],
  '✌️': ['peace', 'victory', 'two', 'fingers'],
  '🤞': ['crossed', 'fingers', 'luck', 'hope', 'wish'],
  '🤟': ['love', 'you', 'rock', 'sign'],
  '🤘': ['rock', 'metal', 'horns', 'devil'],
  '👌': ['ok', 'okay', 'perfect', 'fine', 'good'],
  '🤌': ['italian', 'pinched', 'fingers', 'chef', 'kiss'],
  '💪': ['muscle', 'strong', 'flex', 'bicep', 'power', 'strength'],
  '👊': ['fist', 'bump', 'punch', 'bro'],
  '✊': ['fist', 'raised', 'power', 'solidarity'],
  // Hearts and love
  '❤️': ['heart', 'love', 'red', 'romance'],
  '🧡': ['heart', 'orange', 'love'],
  '💛': ['heart', 'yellow', 'love', 'friendship'],
  '💚': ['heart', 'green', 'love', 'nature', 'envy'],
  '💙': ['heart', 'blue', 'love', 'trust'],
  '💜': ['heart', 'purple', 'love'],
  '🖤': ['heart', 'black', 'love', 'dark'],
  '🤍': ['heart', 'white', 'love', 'pure'],
  '💕': ['hearts', 'two', 'love', 'affection'],
  '💖': ['heart', 'sparkle', 'love', 'sparkling'],
  '💗': ['heart', 'growing', 'love'],
  '💘': ['heart', 'arrow', 'cupid', 'love', 'valentine'],
  '💝': ['heart', 'ribbon', 'gift', 'love', 'valentine'],
  '💔': ['broken', 'heart', 'sad', 'heartbreak'],
  '🔥': ['fire', 'hot', 'flame', 'lit', 'awesome', 'popular'],
  // Celebration
  '🎉': ['party', 'celebration', 'tada', 'congratulations', 'confetti'],
  '🎊': ['confetti', 'ball', 'party', 'celebration'],
  '🎈': ['balloon', 'party', 'birthday', 'celebration'],
  '🎁': ['gift', 'present', 'wrapped', 'birthday', 'christmas'],
  '🎂': ['cake', 'birthday', 'celebration', 'dessert'],
  '🥂': ['cheers', 'toast', 'champagne', 'celebrate', 'glasses'],
  '🍾': ['champagne', 'bottle', 'celebrate', 'party', 'pop'],
  // Animals
  '🐶': ['dog', 'puppy', 'pet', 'animal', 'cute'],
  '🐱': ['cat', 'kitten', 'pet', 'animal', 'cute'],
  '🐰': ['rabbit', 'bunny', 'pet', 'animal', 'easter'],
  '🐻': ['bear', 'animal', 'teddy', 'cute'],
  '🐼': ['panda', 'bear', 'animal', 'cute', 'china'],
  '🦊': ['fox', 'animal', 'clever', 'cute'],
  '🦁': ['lion', 'king', 'animal', 'brave', 'cat'],
  '🐯': ['tiger', 'animal', 'cat', 'fierce'],
  '🦄': ['unicorn', 'magic', 'fantasy', 'rainbow', 'horse'],
  '🐝': ['bee', 'honey', 'insect', 'buzz'],
  '🦋': ['butterfly', 'insect', 'beautiful', 'nature'],
  '🐢': ['turtle', 'slow', 'animal', 'shell'],
  '🐍': ['snake', 'reptile', 'slither'],
  '🐬': ['dolphin', 'ocean', 'sea', 'marine', 'smart'],
  '🐳': ['whale', 'ocean', 'sea', 'marine', 'big'],
  '🦈': ['shark', 'ocean', 'fish', 'predator'],
  // Food and drink
  '🍕': ['pizza', 'food', 'italian', 'slice'],
  '🍔': ['burger', 'hamburger', 'food', 'fast'],
  '🍟': ['fries', 'french', 'food', 'fast', 'potato'],
  '🌮': ['taco', 'mexican', 'food'],
  '🌯': ['burrito', 'mexican', 'food', 'wrap'],
  '🍣': ['sushi', 'japanese', 'food', 'fish', 'rice'],
  '🍜': ['noodles', 'ramen', 'soup', 'asian', 'food'],
  '🍝': ['spaghetti', 'pasta', 'italian', 'food'],
  '🍦': ['ice', 'cream', 'dessert', 'sweet', 'cold'],
  '🍩': ['donut', 'doughnut', 'dessert', 'sweet'],
  '🍪': ['cookie', 'dessert', 'sweet', 'biscuit'],
  '🍫': ['chocolate', 'candy', 'sweet', 'dessert'],
  '🍰': ['cake', 'slice', 'dessert', 'sweet', 'birthday'],
  '☕': ['coffee', 'drink', 'hot', 'cafe', 'morning', 'espresso'],
  '🍵': ['tea', 'drink', 'hot', 'green', 'japanese'],
  '🍺': ['beer', 'drink', 'alcohol', 'cheers'],
  '🍻': ['beers', 'cheers', 'drink', 'alcohol', 'toast'],
  '🍷': ['wine', 'drink', 'alcohol', 'red', 'glass'],
  // Objects and tech
  '💻': ['computer', 'laptop', 'tech', 'work', 'device'],
  '📱': ['phone', 'mobile', 'smartphone', 'device', 'cell'],
  '⌨️': ['keyboard', 'typing', 'computer', 'tech'],
  '🖥️': ['desktop', 'computer', 'monitor', 'screen'],
  '🎮': ['game', 'controller', 'gaming', 'video', 'play'],
  '🎧': ['headphones', 'music', 'audio', 'listen'],
  '📷': ['camera', 'photo', 'picture', 'photography'],
  '📸': ['camera', 'flash', 'photo', 'selfie'],
  '🎬': ['movie', 'film', 'cinema', 'clapperboard', 'action'],
  '📚': ['books', 'reading', 'study', 'library', 'learn'],
  '📖': ['book', 'reading', 'open', 'study'],
  '✏️': ['pencil', 'write', 'edit', 'school'],
  '💡': ['idea', 'lightbulb', 'bright', 'think', 'creative'],
  '🔑': ['key', 'lock', 'security', 'unlock'],
  '💰': ['money', 'bag', 'rich', 'cash', 'dollar'],
  '💵': ['dollar', 'money', 'cash', 'bill', 'currency'],
  '💎': ['diamond', 'gem', 'precious', 'valuable', 'jewel'],
  // Nature and weather
  '🌸': ['cherry', 'blossom', 'flower', 'spring', 'pink', 'japan'],
  '💮': ['flower', 'white', 'nature'],
  '🏵️': ['rosette', 'flower', 'nature', 'award'],
  '🌹': ['rose', 'flower', 'red', 'love', 'romantic'],
  '🥀': ['wilted', 'flower', 'dead', 'sad', 'withered'],
  '🌻': ['sunflower', 'flower', 'yellow', 'summer', 'sun'],
  '🌺': ['hibiscus', 'flower', 'tropical', 'pink'],
  '🌼': ['blossom', 'flower', 'yellow', 'nature'],
  '🌷': ['tulip', 'flower', 'spring', 'nature', 'pink'],
  '🌱': ['seedling', 'plant', 'grow', 'sprout', 'nature'],
  '🪴': ['potted', 'plant', 'house', 'nature', 'indoor'],
  '🌲': ['evergreen', 'tree', 'pine', 'christmas', 'forest'],
  '🌳': ['tree', 'deciduous', 'nature', 'forest', 'oak'],
  '🌴': ['palm', 'tree', 'tropical', 'beach', 'island'],
  '🌵': ['cactus', 'desert', 'plant', 'dry'],
  '🍀': ['clover', 'four', 'leaf', 'lucky', 'luck', 'irish'],
  '☘️': ['shamrock', 'clover', 'irish', 'nature', 'green'],
  '🍃': ['leaf', 'wind', 'blow', 'nature', 'green'],
  '🍂': ['fallen', 'leaf', 'autumn', 'fall', 'nature'],
  '🍁': ['maple', 'leaf', 'fall', 'autumn', 'canada'],
  '🍄': ['mushroom', 'fungus', 'nature', 'forest'],
  '🌾': ['rice', 'sheaf', 'harvest', 'grain', 'wheat'],
  '🪻': ['hyacinth', 'flower', 'lavender', 'nature', 'purple'],
  '🪷': ['lotus', 'flower', 'nature', 'zen', 'meditation'],
  '🌿': ['herb', 'plant', 'leaf', 'green', 'nature'],
  '🪨': ['rock', 'stone', 'boulder', 'nature'],
  '🌍': ['earth', 'globe', 'world', 'africa', 'europe'],
  '🌎': ['earth', 'globe', 'world', 'americas'],
  '🌏': ['earth', 'globe', 'world', 'asia', 'australia'],
  '🌕': ['full', 'moon', 'night', 'sky'],
  '🌈': ['rainbow', 'colors', 'colorful', 'pride', 'lgbtq'],
  '⭐': ['star', 'favorite', 'night', 'sky', 'special'],
  '🌟': ['star', 'glowing', 'sparkle', 'shine', 'special'],
  '✨': ['sparkles', 'magic', 'shine', 'special', 'glitter', 'new'],
  '💫': ['dizzy', 'star', 'sparkle', 'magic'],
  '🌙': ['moon', 'night', 'crescent', 'sleep'],
  '☀️': ['sun', 'sunny', 'weather', 'bright', 'hot'],
  '⛅': ['cloudy', 'weather', 'partly', 'sun', 'cloud'],
  '🌧️': ['rain', 'rainy', 'weather', 'cloud'],
  '⛈️': ['storm', 'thunder', 'lightning', 'weather'],
  '🌪️': ['tornado', 'storm', 'wind', 'weather', 'twister'],
  '❄️': ['snow', 'snowflake', 'cold', 'winter', 'frozen'],
  '☃️': ['snowman', 'winter', 'cold', 'snow', 'christmas'],
  '⛄': ['snowman', 'winter', 'cold', 'snow'],
  '💧': ['droplet', 'water', 'tear', 'sweat'],
  '🌊': ['wave', 'ocean', 'sea', 'water', 'surf'],
  '☔': ['umbrella', 'rain', 'weather', 'wet'],
  // Misc popular
  '💯': ['hundred', 'perfect', 'score', '100', 'complete'],
  '✅': ['check', 'done', 'complete', 'yes', 'correct'],
  '❌': ['cross', 'wrong', 'no', 'incorrect', 'cancel', 'delete'],
  '❗': ['exclamation', 'important', 'alert', 'attention'],
  '❓': ['question', 'what', 'confused', 'ask'],
  '💤': ['sleep', 'zzz', 'tired', 'sleepy', 'snore'],
  '💬': ['speech', 'bubble', 'talk', 'chat', 'message', 'comment'],
  '👀': ['eyes', 'look', 'see', 'watch', 'stare', 'peek'],
  '👁️': ['eye', 'look', 'see', 'watch'],
  '🗣️': ['speaking', 'head', 'talk', 'say', 'announce'],
  '🚀': ['rocket', 'launch', 'space', 'fast', 'moon', 'ship'],
  '⚡': ['lightning', 'bolt', 'electric', 'fast', 'power', 'energy', 'zap'],
  '🏆': ['trophy', 'winner', 'champion', 'award', 'prize', 'first'],
  '🎯': ['target', 'bullseye', 'goal', 'aim', 'direct'],
  '🎵': ['music', 'note', 'song', 'melody'],
  '🎶': ['music', 'notes', 'song', 'melody', 'singing'],
  '🔔': ['bell', 'notification', 'alert', 'ring'],
  '📌': ['pin', 'pushpin', 'location', 'mark', 'important'],
  '🔗': ['link', 'chain', 'url', 'connection'],
  '⚙️': ['gear', 'settings', 'config', 'cog', 'options'],
  '🛠️': ['tools', 'build', 'repair', 'fix', 'work'],
  '⏰': ['alarm', 'clock', 'time', 'wake'],
  '📅': ['calendar', 'date', 'schedule', 'event'],
  '📊': ['chart', 'graph', 'statistics', 'data', 'bar'],
  '📈': ['chart', 'increase', 'up', 'growth', 'trending'],
  '📉': ['chart', 'decrease', 'down', 'decline'],
};

type ViewMode = 'icon' | 'full';

interface ReactionGroup {
  content: string;
  count: number;
  pubkeys: string[];
  userReacted: boolean;
}

interface EmojiSetGroup {
  id: string;
  title: string;
  emojis: { shortcode: string; url: string }[];
}

@Component({
  selector: 'app-reaction-button',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    RouterLink,
    CustomDialogComponent
  ],
  templateUrl: './reaction-button.component.html',
  styleUrls: ['./reaction-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReactionButtonComponent {
  private readonly eventService = inject(EventService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly reactionService = inject(ReactionService);
  private readonly layout = inject(LayoutService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly data = inject(DataService);
  private readonly database = inject(DatabaseService);
  private readonly userData = inject(UserDataService);
  private readonly logger = inject(LoggerService);
  private readonly localSettings = inject(LocalSettingsService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Menu trigger references to close the menu after reaction
  private readonly menuTrigger = viewChild<MatMenuTrigger>('menuTrigger');
  private readonly menuTriggerFull = viewChild<MatMenuTrigger>('menuTriggerFull');

  /** Opens the reaction picker menu. Called from parent when label is clicked. */
  openMenu(): void {
    this.menuTrigger()?.openMenu();
  }

  // Long-press detection state
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTriggered = false;
  private readonly LONG_PRESS_DURATION = 500; // ms

  /**
   * Send the user's default reaction emoji (from settings) on a single tap.
   * If the user already reacted, toggle off their reaction instead.
   */
  sendDefaultReaction(): void {
    const defaultEmoji = this.localSettings.defaultReactionEmoji();
    if (!defaultEmoji) {
      this.openMenu();
      return;
    }
    this.addReaction(defaultEmoji);
  }

  /**
   * Handle pointer down for long-press detection.
   * Starts a timer; if held long enough, opens the emoji picker menu.
   */
  onPointerDown(): void {
    if (!this.isBrowser) return;
    this.longPressTriggered = false;
    this.longPressTimer = setTimeout(() => {
      this.longPressTriggered = true;
      this.openMenu();
    }, this.LONG_PRESS_DURATION);
  }

  /**
   * Handle pointer up: if long-press was not triggered, send the default reaction.
   */
  onPointerUp(event: PointerEvent): void {
    if (!this.isBrowser) return;
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (!this.longPressTriggered) {
      event.preventDefault();
      event.stopPropagation();
      this.sendDefaultReaction();
    }
    this.longPressTriggered = false;
  }

  /**
   * Cancel long-press if pointer leaves the element.
   */
  onPointerLeave(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressTriggered = false;
  }

  isLoadingReactions = signal<boolean>(false);
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });
  customEmojis = signal<{ shortcode: string; url: string }[]>([]);
  emojiSets = signal<EmojiSetGroup[]>([]);
  recentEmojis = signal<RecentEmoji[]>([]);
  activeTabIndex = signal<number>(0);
  emojiSearchQuery = signal<string>('');
  showSigningErrorDialog = signal<boolean>(false);
  signingErrorMessage = signal<string>('');

  // Emoji categories for tabbed display
  readonly emojiCategories = EMOJI_CATEGORIES;

  // Quick reactions for the picker
  readonly quickReactions = ['👍', '❤️', '😂', '🔥', '🎉', '👏'];

  event = input.required<Event>();
  view = input<ViewMode>('icon');
  // Accept reactions from parent to avoid duplicate queries
  // If not provided, component will load independently
  reactionsFromParent = input<ReactionEvents | null>(null);

  // Output to notify parent to reload reactions
  reactionChanged = output<void>();

  likeReaction = computed<NostrRecord | undefined>(() => {
    const event = this.event();
    if (!event) return;
    return this.reactions().events.find(
      r => r.event.pubkey === this.accountState.pubkey() && r.event.content === '+'
    );
  });

  likes = computed<NostrRecord[]>(() => {
    return this.reactions().events.filter(r => r.event.content === '+');
  });

  // Computed: Get user's reaction (any emoji they reacted with)
  userReaction = computed<NostrRecord | undefined>(() => {
    const event = this.event();
    if (!event) return;
    return this.reactions().events.find(
      r => r.event.pubkey === this.accountState.pubkey()
    );
  });

  // Computed: Group reactions by emoji
  reactionGroups = computed<ReactionGroup[]>(() => {
    const currentUserPubkey = this.accountState.pubkey();
    const groups = new Map<string, ReactionGroup>();
    const reactions = this.reactions();

    for (const record of reactions.events) {
      const emoji = record.event.content;
      if (!groups.has(emoji)) {
        groups.set(emoji, {
          content: emoji,
          count: 0,
          pubkeys: [],
          userReacted: false
        });
      }
      const group = groups.get(emoji)!;
      group.count++;
      group.pubkeys.push(record.event.pubkey);
      if (record.event.pubkey === currentUserPubkey) {
        group.userReacted = true;
      }
    }

    return Array.from(groups.values());
  });

  // Computed: Total reaction count
  totalReactionCount = computed<number>(() => {
    return this.reactions().events.length;
  });

  // Computed: Search results for emoji search
  searchResults = computed<{ unicode: string[]; custom: { shortcode: string; url: string }[] }>(() => {
    const query = this.emojiSearchQuery().toLowerCase().trim();
    if (!query) {
      return { unicode: [], custom: [] };
    }

    // Search unicode emojis by keywords
    const unicodeMatches: string[] = [];
    for (const [emoji, keywords] of Object.entries(EMOJI_KEYWORDS)) {
      if (keywords.some(kw => kw.includes(query))) {
        unicodeMatches.push(emoji);
      }
    }

    // Also search all category emojis if not found in keywords
    if (unicodeMatches.length < 20) {
      for (const category of EMOJI_CATEGORIES) {
        for (const emoji of category.emojis) {
          if (!unicodeMatches.includes(emoji)) {
            // Check if category label matches
            if (category.label.toLowerCase().includes(query)) {
              unicodeMatches.push(emoji);
            }
          }
        }
      }
    }

    // Search custom emojis by shortcode
    const customMatches = this.customEmojis().filter(e =>
      e.shortcode.toLowerCase().includes(query)
    );

    return {
      unicode: unicodeMatches.slice(0, 50),
      custom: customMatches.slice(0, 20)
    };
  });

  constructor() {
    // Load user's custom emojis and emoji sets
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.customEmojis.set([]);
        this.emojiSets.set([]);
        this.recentEmojis.set([]);
        return;
      }

      untracked(async () => {
        try {
          // Load recent emojis from local state
          const recent = this.accountLocalState.getRecentEmojis(pubkey);
          this.recentEmojis.set(recent);

          // Load user's custom emojis
          const userEmojis = await this.emojiSetService.getUserEmojiSets(pubkey);
          const emojiArray = Array.from(userEmojis.entries()).map(([shortcode, url]) => ({ shortcode, url }));
          this.customEmojis.set(emojiArray);

          // Load emoji sets grouped by set for tabbed display
          await this.loadEmojiSetsGrouped(pubkey);
        } catch (error) {
          this.logger.error('Failed to load custom emojis for reactions:', error);
          this.customEmojis.set([]);
          this.emojiSets.set([]);
        }
      });
    });

    // Watch for parent reactions and use them when available
    effect(() => {
      const parentReactions = this.reactionsFromParent();

      // If parent provides reactions, use them
      if (parentReactions !== null) {
        this.reactions.set(parentReactions);
      }
    });

    // Fallback: Load reactions independently only if parent doesn't provide them
    // This handles standalone usage of the component
    effect(() => {
      const event = this.event();
      const parentReactions = this.reactionsFromParent();

      if (!event || parentReactions !== null) {
        return;
      }

      // Load independently only if no parent data is being managed
      untracked(async () => {
        this.loadReactions();
      });
    });
  }

  async addReaction(emoji: string) {
    // Close the menu immediately after selection
    this.closeMenu();

    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const event = this.event();
    if (!event) return;

    // Check if user already reacted with this emoji
    const existingReaction = this.reactions().events.find(
      r => r.event.pubkey === userPubkey && r.event.content === emoji
    );

    if (existingReaction) {
      // Remove the reaction
      await this.removeReaction(existingReaction, emoji);
    } else {
      // Check if user has any existing reaction (to remove it first if different)
      const userExistingReaction = this.userReaction();
      if (userExistingReaction) {
        // Remove old reaction first
        await this.removeReaction(userExistingReaction, userExistingReaction.event.content);
      }
      // Add new reaction
      await this.addNewReaction(emoji);
    }
  }

  closeMenu() {
    this.menuTrigger()?.closeMenu();
    this.menuTriggerFull()?.closeMenu();
  }

  private async removeReaction(reaction: NostrRecord, emoji: string) {
    this.isLoadingReactions.set(true);
    try {
      this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, false);
      const result = await this.reactionService.deleteReaction(reaction.event);
      if (!result.success) {
        this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, true);
        this.handleReactionError(result.error, 'Failed to remove reaction. Please try again.');
      } else {
        // Notify parent to reload reactions
        this.reactionChanged.emit();
      }
      // Reload reactions in the background to sync
      setTimeout(() => this.loadReactions(true), 2000);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  private async addNewReaction(emoji: string) {
    const event = this.event();
    if (!event) return;

    this.isLoadingReactions.set(true);
    try {
      // Look up emoji URL from customEmojis or emojiSets before creating reaction
      // This ensures the emoji tag is added to the reaction event (NIP-30)
      let emojiUrl: string | undefined;
      if (emoji.startsWith(':') && emoji.endsWith(':')) {
        const shortcode = emoji.slice(1, -1);
        // First check customEmojis
        const customEmoji = this.customEmojis().find(e => e.shortcode === shortcode);
        if (customEmoji?.url) {
          emojiUrl = customEmoji.url;
        } else {
          // Fallback: check emojiSets
          for (const set of this.emojiSets()) {
            const setEmoji = set.emojis.find(e => e.shortcode === shortcode);
            if (setEmoji?.url) {
              emojiUrl = setEmoji.url;
              break;
            }
          }
        }
      }

      this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, true);
      const result = await this.reactionService.addReaction(emoji, event, emojiUrl);
      if (!result.success) {
        this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, false);
        this.handleReactionError(result.error, 'Failed to add reaction. Please try again.');
      } else {
        // Track emoji usage for recent emojis
        this.trackEmojiUsage(emoji, emojiUrl);
        // Notify parent to reload reactions
        this.reactionChanged.emit();
      }
      // Reload reactions in the background to sync
      setTimeout(() => this.loadReactions(true), 2000);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  async toggleLike() {
    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    const event = this.event();
    if (!event) return;

    this.isLoadingReactions.set(true);

    try {
      const existingLikeReaction = this.likeReaction();

      if (existingLikeReaction) {
        // Remove like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', false);

        const result = await this.reactionService.deleteReaction(existingLikeReaction.event);
        if (!result.success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', true);
          this.handleReactionError(result.error, 'Failed to remove like. Please try again.');
        }
      } else {
        // Add like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', true);

        const result = await this.reactionService.addLike(event);
        if (!result.success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', false);
          this.handleReactionError(result.error, 'Failed to add like. Please try again.');
        }
      }

      // Reload reactions in the background to sync with the network
      setTimeout(() => {
        this.loadReactions(true);
      }, 2000);

    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  isExtensionError(error?: string): boolean {
    if (!error) return false;
    return error.includes('Nostr extension not found') ||
      error.includes('NIP-07') ||
      error.includes('extension');
  }

  handleReactionError(error: string | undefined, fallbackMessage: string): void {
    if (this.isExtensionError(error)) {
      this.signingErrorMessage.set(error!);
      this.showSigningErrorDialog.set(true);
    } else {
      this.snackBar.open(fallbackMessage, 'Dismiss', { duration: 3000 });
    }
  }

  closeSigningErrorDialog(): void {
    this.showSigningErrorDialog.set(false);
    this.signingErrorMessage.set('');
  }

  async loadReactions(invalidateCache = false) {
    const event = this.event();
    if (!event) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    this.isLoadingReactions.set(true);
    try {
      const reactions = await this.eventService.loadReactions(
        event.id,
        userPubkey,
        invalidateCache
      );
      this.reactions.set(reactions);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  /**
   * Get the display text for a reaction
   * Converts '+' to heart emoji, otherwise displays the actual reaction content
   */
  getReactionDisplay(content: string): string {
    if (!content || content === '+') {
      return '❤️';
    }
    return content;
  }

  /**
   * Look up a custom emoji URL by shortcode from user's loaded emoji sets.
   * Checks customEmojis, recentEmojis, and emojiSets in order.
   * @param shortcode The emoji shortcode without colons (e.g., 'catJAM')
   * @param emojiWithColons The full emoji string with colons (e.g., ':catJAM:') for recent emoji lookup
   */
  private lookupEmojiUrlByShortcode(shortcode: string, emojiWithColons?: string): string | null {
    // Check user's loaded custom emojis
    const customEmoji = this.customEmojis().find(e => e.shortcode === shortcode);
    if (customEmoji?.url) {
      return customEmoji.url;
    }

    // Check recent emojis (they store the URL when used)
    if (emojiWithColons) {
      const recentEmoji = this.recentEmojis().find(e => e.emoji === emojiWithColons);
      if (recentEmoji?.url) {
        return recentEmoji.url;
      }
    }

    // Check all emoji sets
    for (const set of this.emojiSets()) {
      const emoji = set.emojis.find(e => e.shortcode === shortcode);
      if (emoji?.url) {
        return emoji.url;
      }
    }

    return null;
  }

  /**
   * Get custom emoji URL from reaction event tags (NIP-30)
   * Returns the image URL if the reaction has an emoji tag matching the content.
   * Falls back to user's emoji sets if the event doesn't have the emoji tag.
   */
  getCustomEmojiUrl(event: Event): string | null {
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return null;
    }

    const shortcode = event.content.slice(1, -1); // Remove colons

    // First, check if the event has an emoji tag
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
    if (emojiTag?.[2]) {
      return emojiTag[2];
    }

    // Fall back to user's emoji sets
    return this.lookupEmojiUrlByShortcode(shortcode, event.content);
  }

  /**
   * Optimistically update reactions for immediate UI feedback
   */
  private updateReactionsOptimistically(userPubkey: string, emoji: string, isAdding: boolean) {
    const currentReactions = this.reactions();
    const currentEvents = [...currentReactions.events];
    const currentData = new Map(currentReactions.data);
    const currentEvent = this.event();

    if (isAdding) {
      // Create a temporary reaction event for optimistic UI
      const baseTags: string[][] = [
        ['e', currentEvent?.id || ''],
        ['p', currentEvent?.pubkey || ''],
        ['k', currentEvent?.kind.toString() || ''],
      ];

      // Check if this is a custom emoji and add emoji tag for NIP-30
      // emoji format is :shortcode:, so extract the shortcode without colons
      const isCustomEmoji = emoji.startsWith(':') && emoji.endsWith(':');
      if (isCustomEmoji) {
        const shortcode = emoji.slice(1, -1);
        // First check customEmojis
        let emojiUrl: string | undefined;
        const customEmoji = this.customEmojis().find(e => e.shortcode === shortcode);
        if (customEmoji?.url) {
          emojiUrl = customEmoji.url;
        } else {
          // Fallback: check emojiSets
          for (const set of this.emojiSets()) {
            const setEmoji = set.emojis.find(e => e.shortcode === shortcode);
            if (setEmoji?.url) {
              emojiUrl = setEmoji.url;
              break;
            }
          }
        }
        if (emojiUrl) {
          baseTags.push(['emoji', shortcode, emojiUrl]);
        }
      }

      const tempReactionEvent = {
        id: `temp-${userPubkey}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        pubkey: userPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: kinds.Reaction,
        content: emoji,
        tags: baseTags,
        sig: '',
      };

      const tempRecord = {
        event: tempReactionEvent,
        data: emoji,
      };

      currentEvents.push(tempRecord);
      currentData.set(emoji, (currentData.get(emoji) || 0) + 1);
    } else {
      // Remove the user's reaction
      const userReactionIndex = currentEvents.findIndex(
        r => r.event.pubkey === userPubkey && r.event.content === emoji
      );

      if (userReactionIndex !== -1) {
        currentEvents.splice(userReactionIndex, 1);
        const currentCount = currentData.get(emoji) || 0;
        if (currentCount > 1) {
          currentData.set(emoji, currentCount - 1);
        } else {
          currentData.delete(emoji);
        }
      }
    }

    this.reactions.set({
      events: currentEvents,
      data: currentData,
    });
  }

  /**
   * Load emoji sets grouped by their set for tabbed display
   */
  private async loadEmojiSetsGrouped(pubkey: string): Promise<void> {
    try {
      // Get user's preferred emojis list (kind 10030)
      // Use UserDataService to fetch from database first, then from relays if not found
      const emojiListRecord = await this.userData.getEventByPubkeyAndKind(pubkey, 10030, { save: true });

      if (!emojiListRecord) {
        this.emojiSets.set([]);
        return;
      }

      const emojiListEvent = emojiListRecord.event;
      const sets: EmojiSetGroup[] = [];

      // First, add inline emojis as "My Emojis" set
      const inlineEmojis: { shortcode: string; url: string }[] = [];
      for (const tag of emojiListEvent.tags) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          inlineEmojis.push({ shortcode: tag[1], url: tag[2] });
        }
      }
      if (inlineEmojis.length > 0) {
        sets.push({
          id: 'inline',
          title: 'My Emojis',
          emojis: inlineEmojis
        });
      }

      // Process emoji set references (a tags pointing to kind 30030)
      const emojiSetRefs = emojiListEvent.tags.filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30030:'));

      for (const ref of emojiSetRefs) {
        const [kind, refPubkey, identifier] = ref[1].split(':');
        if (kind === '30030' && refPubkey && identifier) {
          const emojiSet = await this.emojiSetService.getEmojiSet(refPubkey, identifier);
          if (emojiSet) {
            const emojis = Array.from(emojiSet.emojis.entries()).map(([shortcode, url]) => ({ shortcode, url }));
            sets.push({
              id: emojiSet.id,
              title: emojiSet.title,
              emojis
            });
          }
        }
      }

      this.emojiSets.set(sets);
    } catch (error) {
      this.logger.error('Failed to load emoji sets grouped:', error);
      this.emojiSets.set([]);
    }
  }

  /**
   * Track emoji usage for recent emojis
   */
  private trackEmojiUsage(emoji: string, url?: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    this.accountLocalState.addRecentEmoji(pubkey, emoji, url);

    // Update local signal immediately for UI responsiveness
    const recent = this.accountLocalState.getRecentEmojis(pubkey);
    this.recentEmojis.set(recent);
  }

  /**
   * Get the URL for a custom emoji by its shortcode format (:shortcode:)
   */
  getCustomEmojiUrlByShortcode(emoji: string): string | null {
    if (!emoji.startsWith(':') || !emoji.endsWith(':')) {
      return null;
    }
    const shortcode = emoji.slice(1, -1);
    return this.lookupEmojiUrlByShortcode(shortcode, emoji);
  }

  /**
   * Get the URL for a custom emoji in reaction groups display.
   * First checks if any reaction event has the emoji tag, then falls back to user's emoji sets.
   */
  getCustomEmojiUrlForGroup(content: string): string | null {
    if (!content.startsWith(':') || !content.endsWith(':')) {
      return null;
    }

    // First, try to find a reaction event with the emoji tag
    const reactionWithTag = this.reactions().events.find(
      r => r.event.content === content && this.getCustomEmojiUrl(r.event)
    );
    if (reactionWithTag) {
      return this.getCustomEmojiUrl(reactionWithTag.event);
    }

    // Fall back to user's emoji sets
    const shortcode = content.slice(1, -1);
    return this.lookupEmojiUrlByShortcode(shortcode, content);
  }
}
