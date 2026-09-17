// The Emoji Picker's catalogue: the emoji people actually reach for, grouped
// the way every keyboard groups them, with the names and a few extra search
// words each. Written as "emoji|name|keywords" lines to keep the file small.
// Entries marked with a trailing * take a skin tone.

const RAW = {
  Smileys: `
😀|grinning face|smile happy
😃|grinning face with big eyes|smile happy
😄|grinning face with smiling eyes|smile happy
😁|beaming face|grin teeth
😆|grinning squinting face|laugh xd
😅|grinning face with sweat|nervous phew
🤣|rolling on the floor laughing|rofl lol
😂|face with tears of joy|lol crying laughing
🙂|slightly smiling face|smile
🙃|upside-down face|silly
🫠|melting face|hot embarrassed
😉|winking face|wink
😊|smiling face with smiling eyes|blush happy
😇|smiling face with halo|angel innocent
🥰|smiling face with hearts|love adore
😍|smiling face with heart-eyes|love
🤩|star-struck|wow excited
😘|face blowing a kiss|kiss love
😗|kissing face|kiss
😚|kissing face with closed eyes|kiss
😙|kissing face with smiling eyes|kiss
🥲|smiling face with tear|bittersweet
😋|face savoring food|yum delicious
😛|face with tongue|tongue
😜|winking face with tongue|silly
🤪|zany face|crazy wild
😝|squinting face with tongue|silly
🤑|money-mouth face|rich dollar
🤗|smiling face with open hands|hug
🤭|face with hand over mouth|oops giggle
🫢|face with open eyes and hand over mouth|gasp
🫣|face with peeking eye|peek shy
🤫|shushing face|quiet secret
🤔|thinking face|hmm
🫡|saluting face|salute yes sir
🤐|zipper-mouth face|secret
🤨|face with raised eyebrow|suspicious
😐|neutral face|meh
😑|expressionless face|blank
😶|face without mouth|silent
🫥|dotted line face|invisible
😶‍🌫️|face in clouds|foggy absent
😏|smirking face|smug
😒|unamused face|meh annoyed
🙄|face with rolling eyes|eyeroll
😬|grimacing face|awkward
😮‍💨|face exhaling|sigh relief
🤥|lying face|pinocchio
🫨|shaking face|shocked
😌|relieved face|calm
😔|pensive face|sad
😪|sleepy face|tired
🤤|drooling face|drool
😴|sleeping face|zzz sleep
😷|face with medical mask|sick mask
🤒|face with thermometer|sick fever
🤕|face with head-bandage|hurt injured
🤢|nauseated face|sick green
🤮|face vomiting|sick puke
🤧|sneezing face|sick achoo
🥵|hot face|heat sweating
🥶|cold face|freezing
🥴|woozy face|drunk dizzy
😵|face with crossed-out eyes|dead dizzy
😵‍💫|face with spiral eyes|dizzy hypnotised
🤯|exploding head|mind blown
🤠|cowboy hat face|yeehaw
🥳|partying face|party celebrate birthday
🥸|disguised face|incognito
😎|smiling face with sunglasses|cool
🤓|nerd face|glasses geek
🧐|face with monocle|fancy inspect
😕|confused face|
🫤|face with diagonal mouth|meh
😟|worried face|
🙁|slightly frowning face|sad
☹️|frowning face|sad
😮|face with open mouth|surprised
😯|hushed face|surprised
😲|astonished face|shocked
😳|flushed face|embarrassed blush
🥺|pleading face|puppy eyes please
🥹|face holding back tears|touched
😦|frowning face with open mouth|
😧|anguished face|
😨|fearful face|scared
😰|anxious face with sweat|nervous
😥|sad but relieved face|
😢|crying face|sad tear
😭|loudly crying face|sob
😱|face screaming in fear|scared scream
😖|confounded face|
😣|persevering face|
😞|disappointed face|sad
😓|downcast face with sweat|
😩|weary face|tired
😫|tired face|
🥱|yawning face|bored sleepy
😤|face with steam from nose|angry frustrated
😡|enraged face|angry red mad
😠|angry face|mad
🤬|face with symbols on mouth|swearing cursing
😈|smiling face with horns|devil evil
👿|angry face with horns|devil
💀|skull|dead death
☠️|skull and crossbones|poison danger
💩|pile of poo|poop
🤡|clown face|
👹|ogre|monster
👺|goblin|
👻|ghost|boo halloween
👽|alien|ufo
👾|alien monster|space invader game
🤖|robot|bot
😺|grinning cat|
😸|grinning cat with smiling eyes|
😹|cat with tears of joy|
😻|smiling cat with heart-eyes|
😼|cat with wry smile|
😽|kissing cat|
🙀|weary cat|
😿|crying cat|
😾|pouting cat|
🙈|see-no-evil monkey|
🙉|hear-no-evil monkey|
🙊|speak-no-evil monkey|
`,
  'Gestures & People': `
👋|waving hand|hi bye hello*
🤚|raised back of hand|*
🖐️|hand with fingers splayed|*
✋|raised hand|stop high five*
🖖|vulcan salute|spock*
🫱|rightwards hand|*
🫲|leftwards hand|*
🫳|palm down hand|*
🫴|palm up hand|*
🫷|leftwards pushing hand|*
🫸|rightwards pushing hand|*
👌|ok hand|okay perfect*
🤌|pinched fingers|italian*
🤏|pinching hand|small*
✌️|victory hand|peace*
🤞|crossed fingers|luck hope*
🫰|hand with index finger and thumb crossed|love money*
🤟|love-you gesture|*
🤘|sign of the horns|rock metal*
🤙|call me hand|shaka*
👈|backhand index pointing left|*
👉|backhand index pointing right|*
👆|backhand index pointing up|*
🖕|middle finger|rude*
👇|backhand index pointing down|*
☝️|index pointing up|*
🫵|index pointing at the viewer|you*
👍|thumbs up|like yes good*
👎|thumbs down|dislike no bad*
✊|raised fist|power*
👊|oncoming fist|punch bump*
🤛|left-facing fist|*
🤜|right-facing fist|*
👏|clapping hands|applause bravo*
🙌|raising hands|hooray celebrate*
🫶|heart hands|love*
👐|open hands|*
🤲|palms up together|pray*
🤝|handshake|deal agreement*
🙏|folded hands|pray please thanks*
✍️|writing hand|*
💅|nail polish|sassy*
🤳|selfie|*
💪|flexed biceps|strong muscle gym*
🦾|mechanical arm|
🦿|mechanical leg|
🦵|leg|*
🦶|foot|*
👂|ear|listen*
🦻|ear with hearing aid|*
👃|nose|smell*
🧠|brain|smart
🫀|anatomical heart|
🫁|lungs|
🦷|tooth|dentist
🦴|bone|
👀|eyes|look watching
👁️|eye|
👅|tongue|
👄|mouth|lips
🫦|biting lip|
👶|baby|*
🧒|child|kid*
👦|boy|*
👧|girl|*
🧑|person|*
👱|person with blond hair|*
👨|man|*
🧔|person with beard|*
👩|woman|*
🧓|older person|*
👴|old man|grandpa*
👵|old woman|grandma*
🙍|person frowning|*
🙎|person pouting|*
🙅|person gesturing no|*
🙆|person gesturing ok|*
💁|person tipping hand|*
🙋|person raising hand|*
🧏|deaf person|*
🙇|person bowing|sorry*
🤦|person facepalming|*
🤷|person shrugging|dunno*
👮|police officer|cop*
🕵️|detective|spy*
💂|guard|*
🥷|ninja|*
👷|construction worker|*
🫅|person with crown|royal*
🤴|prince|*
👸|princess|*
👳|person wearing turban|*
👲|person with skullcap|*
🧕|woman with headscarf|*
🤵|person in tuxedo|wedding*
👰|person with veil|bride wedding*
🤰|pregnant woman|*
🤱|breast-feeding|*
👼|baby angel|*
🎅|santa claus|christmas*
🤶|mrs. claus|christmas*
🦸|superhero|*
🦹|supervillain|*
🧙|mage|wizard*
🧚|fairy|*
🧛|vampire|*
🧜|merperson|mermaid*
🧝|elf|*
🧞|genie|
🧟|zombie|
🧌|troll|
💆|person getting massage|*
💇|person getting haircut|*
🚶|person walking|*
🧍|person standing|*
🧎|person kneeling|*
🏃|person running|*
💃|woman dancing|*
🕺|man dancing|*
🕴️|person in suit levitating|*
👯|people with bunny ears|
🧖|person in steamy room|sauna*
🧗|person climbing|*
🏇|horse racing|*
⛷️|skier|
🏂|snowboarder|*
🏌️|person golfing|*
🏄|person surfing|*
🚣|person rowing boat|*
🏊|person swimming|*
⛹️|person bouncing ball|*
🏋️|person lifting weights|gym*
🚴|person biking|*
🚵|person mountain biking|*
🤸|person cartwheeling|*
🤼|people wrestling|
🤽|person playing water polo|*
🤾|person playing handball|*
🤹|person juggling|*
🧘|person in lotus position|yoga meditate*
🛀|person taking bath|*
🛌|person in bed|sleep*
👭|women holding hands|
👫|woman and man holding hands|
👬|men holding hands|
💏|kiss|couple
💑|couple with heart|
👪|family|
🗣️|speaking head|
👤|bust in silhouette|user
👥|busts in silhouette|users
🫂|people hugging|
👣|footprints|
`,
  'Hearts & Symbols': `
❤️|red heart|love
🩷|pink heart|
🧡|orange heart|
💛|yellow heart|
💚|green heart|
💙|blue heart|
🩵|light blue heart|
💜|purple heart|
🤎|brown heart|
🖤|black heart|
🩶|grey heart|
🤍|white heart|
💔|broken heart|sad
❤️‍🔥|heart on fire|
❤️‍🩹|mending heart|
❣️|heart exclamation|
💕|two hearts|
💞|revolving hearts|
💓|beating heart|
💗|growing heart|
💖|sparkling heart|
💘|heart with arrow|cupid
💝|heart with ribbon|gift
💟|heart decoration|
💯|hundred points|100 perfect
💢|anger symbol|
💥|collision|boom explosion
💫|dizzy|star
💦|sweat droplets|water
💨|dashing away|wind
🕳️|hole|
💬|speech balloon|chat
👁️‍🗨️|eye in speech bubble|
🗨️|left speech bubble|
🗯️|right anger bubble|
💭|thought balloon|
💤|zzz|sleep
✨|sparkles|magic shiny
⭐|star|
🌟|glowing star|
🔥|fire|lit hot
💧|droplet|water
🌈|rainbow|
☀️|sun|sunny
🌙|crescent moon|night
⚡|high voltage|lightning zap
❄️|snowflake|cold winter
☔|umbrella with rain drops|
☑️|check box with check|done
✔️|check mark|done yes
✅|check mark button|done yes
❌|cross mark|no wrong
❎|cross mark button|
❓|red question mark|
❔|white question mark|
❕|white exclamation mark|
❗|red exclamation mark|warning
‼️|double exclamation mark|
⁉️|exclamation question mark|
⚠️|warning|caution
🚫|prohibited|no ban
🔞|no one under eighteen|
♻️|recycling symbol|
⚜️|fleur-de-lis|
🔱|trident emblem|
📛|name badge|
🔰|japanese symbol for beginner|
⭕|hollow red circle|
🟢|green circle|
🔴|red circle|
🟡|yellow circle|
🔵|blue circle|
🟣|purple circle|
⚫|black circle|
⚪|white circle|
🟥|red square|
🟧|orange square|
🟨|yellow square|
🟩|green square|
🟦|blue square|
🟪|purple square|
⬛|black large square|
⬜|white large square|
🔶|large orange diamond|
🔷|large blue diamond|
🔸|small orange diamond|
🔹|small blue diamond|
🔺|red triangle pointed up|
🔻|red triangle pointed down|
💠|diamond with a dot|
🔘|radio button|
🔲|black square button|
🔳|white square button|
➕|plus|add
➖|minus|
➗|divide|
✖️|multiply|
🟰|heavy equals sign|
♾️|infinity|
💲|heavy dollar sign|
💱|currency exchange|
™️|trade mark|
©️|copyright|
®️|registered|
〰️|wavy dash|
➰|curly loop|
➿|double curly loop|
🔚|end arrow|
🔙|back arrow|
🔛|on arrow|
🔝|top arrow|
🔜|soon arrow|
⬆️|up arrow|
↗️|up-right arrow|
➡️|right arrow|
↘️|down-right arrow|
⬇️|down arrow|
↙️|down-left arrow|
⬅️|left arrow|
↖️|up-left arrow|
↕️|up-down arrow|
↔️|left-right arrow|
↩️|right arrow curving left|
↪️|left arrow curving right|
⤴️|right arrow curving up|
⤵️|right arrow curving down|
🔃|clockwise vertical arrows|
🔄|counterclockwise arrows button|refresh
🔀|shuffle tracks button|
🔁|repeat button|
🔂|repeat single button|
▶️|play button|
⏩|fast-forward button|
⏭️|next track button|
⏯️|play or pause button|
◀️|reverse button|
⏪|fast reverse button|
⏮️|last track button|
🔼|upwards button|
⏫|fast up button|
🔽|downwards button|
⏬|fast down button|
⏸️|pause button|
⏹️|stop button|
⏺️|record button|
⏏️|eject button|
🎦|cinema|
🔅|dim button|
🔆|bright button|
📶|antenna bars|signal
🛜|wireless|wifi
📳|vibration mode|
📴|mobile phone off|
♀️|female sign|
♂️|male sign|
⚧️|transgender symbol|
✝️|latin cross|
☪️|star and crescent|
🕉️|om|
☸️|wheel of dharma|
✡️|star of david|
🔯|dotted six-pointed star|
🕎|menorah|
☯️|yin yang|
☦️|orthodox cross|
🛐|place of worship|
⚛️|atom symbol|science
♈|aries|zodiac
♉|taurus|zodiac
♊|gemini|zodiac
♋|cancer|zodiac
♌|leo|zodiac
♍|virgo|zodiac
♎|libra|zodiac
♏|scorpio|zodiac
♐|sagittarius|zodiac
♑|capricorn|zodiac
♒|aquarius|zodiac
♓|pisces|zodiac
⛎|ophiuchus|zodiac
🔠|input latin uppercase|
🔡|input latin lowercase|
🔢|input numbers|
🔣|input symbols|
🔤|input latin letters|
🅰️|a button|blood type
🆎|ab button|blood type
🅱️|b button|blood type
🆑|cl button|
🆒|cool button|
🆓|free button|
ℹ️|information|
🆔|id button|
Ⓜ️|circled m|
🆕|new button|
🆖|ng button|
🅾️|o button|blood type
🆗|ok button|
🅿️|p button|parking
🆘|sos button|help
🆙|up! button|
🆚|vs button|versus
🏁|chequered flag|finish race
🚩|triangular flag|
🎌|crossed flags|
🏴|black flag|
🏳️|white flag|surrender
🏳️‍🌈|rainbow flag|pride
🏳️‍⚧️|transgender flag|
🏴‍☠️|pirate flag|
`,
  'Animals & Nature': `
🐶|dog face|puppy
🐱|cat face|kitten
🐭|mouse face|
🐹|hamster|
🐰|rabbit face|bunny
🦊|fox|
🐻|bear|
🐼|panda|
🐻‍❄️|polar bear|
🐨|koala|
🐯|tiger face|
🦁|lion|
🐮|cow face|
🐷|pig face|
🐽|pig nose|
🐸|frog|
🐵|monkey face|
🐔|chicken|
🐧|penguin|
🐦|bird|
🐤|baby chick|
🐣|hatching chick|
🐥|front-facing baby chick|
🦆|duck|
🦅|eagle|
🦉|owl|
🦇|bat|
🐺|wolf|
🐗|boar|
🐴|horse face|
🦄|unicorn|
🐝|honeybee|bee
🪱|worm|
🐛|bug|caterpillar
🦋|butterfly|
🐌|snail|
🐞|lady beetle|ladybug
🐜|ant|
🪰|fly|
🪲|beetle|
🪳|cockroach|
🦟|mosquito|
🦗|cricket|
🕷️|spider|
🕸️|spider web|
🦂|scorpion|
🐢|turtle|
🐍|snake|
🦎|lizard|
🦖|t-rex|dinosaur
🦕|sauropod|dinosaur
🐙|octopus|
🦑|squid|
🦐|shrimp|
🦞|lobster|
🦀|crab|
🐡|blowfish|
🐠|tropical fish|
🐟|fish|
🐬|dolphin|
🐳|spouting whale|
🐋|whale|
🦈|shark|
🦭|seal|
🐊|crocodile|
🐅|tiger|
🐆|leopard|
🦓|zebra|
🦍|gorilla|
🦧|orangutan|
🦣|mammoth|
🐘|elephant|
🦛|hippopotamus|
🦏|rhinoceros|
🐪|camel|
🐫|two-hump camel|
🦒|giraffe|
🦘|kangaroo|
🦬|bison|
🐃|water buffalo|
🐂|ox|
🐄|cow|
🐎|horse|
🐖|pig|
🐏|ram|
🐑|ewe|sheep
🦙|llama|
🐐|goat|
🦌|deer|
🐕|dog|
🐩|poodle|
🦮|guide dog|
🐕‍🦺|service dog|
🐈|cat|
🐈‍⬛|black cat|
🪶|feather|
🐓|rooster|
🦃|turkey|
🦤|dodo|
🦚|peacock|
🦜|parrot|
🦢|swan|
🦩|flamingo|
🕊️|dove|peace
🐇|rabbit|
🦝|raccoon|
🦨|skunk|
🦡|badger|
🦫|beaver|
🦦|otter|
🦥|sloth|
🐁|mouse|
🐀|rat|
🐿️|chipmunk|
🦔|hedgehog|
🐾|paw prints|
🐉|dragon|
🐲|dragon face|
🌵|cactus|
🎄|christmas tree|
🌲|evergreen tree|
🌳|deciduous tree|
🌴|palm tree|
🪵|wood|log
🌱|seedling|plant
🌿|herb|
☘️|shamrock|
🍀|four leaf clover|luck
🎍|pine decoration|
🪴|potted plant|
🎋|tanabata tree|
🍃|leaf fluttering in wind|
🍂|fallen leaf|autumn
🍁|maple leaf|canada autumn
🍄|mushroom|
🐚|spiral shell|
🪨|rock|
🌾|sheaf of rice|
💐|bouquet|flowers
🌷|tulip|
🌹|rose|
🥀|wilted flower|
🌺|hibiscus|
🌸|cherry blossom|sakura
🌼|blossom|
🌻|sunflower|
🪷|lotus|
🌞|sun with face|
🌝|full moon face|
🌛|first quarter moon face|
🌜|last quarter moon face|
🌚|new moon face|
🌕|full moon|
🌖|waning gibbous moon|
🌗|last quarter moon|
🌘|waning crescent moon|
🌑|new moon|
🌒|waxing crescent moon|
🌓|first quarter moon|
🌔|waxing gibbous moon|
🌎|globe showing americas|earth world
🌍|globe showing europe-africa|earth world
🌏|globe showing asia-australia|earth world
🪐|ringed planet|saturn
💫|dizzy|
🌠|shooting star|
🌌|milky way|galaxy space
☁️|cloud|
⛅|sun behind cloud|
⛈️|cloud with lightning and rain|storm
🌤️|sun behind small cloud|
🌥️|sun behind large cloud|
🌦️|sun behind rain cloud|
🌧️|cloud with rain|
🌨️|cloud with snow|
🌩️|cloud with lightning|
🌪️|tornado|
🌫️|fog|
🌬️|wind face|
🌀|cyclone|
🌊|water wave|ocean sea
☃️|snowman|
⛄|snowman without snow|
🔥|fire|
`,
  'Food & Drink': `
🍏|green apple|
🍎|red apple|
🍐|pear|
🍊|tangerine|orange
🍋|lemon|
🍌|banana|
🍉|watermelon|
🍇|grapes|
🍓|strawberry|
🫐|blueberries|
🍈|melon|
🍒|cherries|
🍑|peach|
🥭|mango|
🍍|pineapple|
🥥|coconut|
🥝|kiwi fruit|
🍅|tomato|
🍆|eggplant|aubergine
🥑|avocado|
🥦|broccoli|
🥬|leafy green|
🥒|cucumber|
🌶️|hot pepper|chili
🫑|bell pepper|
🌽|ear of corn|
🥕|carrot|
🫒|olive|
🧄|garlic|
🧅|onion|
🥔|potato|
🍠|roasted sweet potato|
🥐|croissant|
🥯|bagel|
🍞|bread|
🥖|baguette bread|
🥨|pretzel|
🧀|cheese wedge|
🥚|egg|
🍳|cooking|fried egg
🧈|butter|
🥞|pancakes|
🧇|waffle|
🥓|bacon|
🥩|cut of meat|steak
🍗|poultry leg|chicken
🍖|meat on bone|
🦴|bone|
🌭|hot dog|
🍔|hamburger|burger
🍟|french fries|chips
🍕|pizza|
🫓|flatbread|
🥪|sandwich|
🥙|stuffed flatbread|
🧆|falafel|
🌮|taco|
🌯|burrito|
🫔|tamale|
🥗|green salad|
🥘|shallow pan of food|paella
🫕|fondue|
🍝|spaghetti|pasta
🍜|steaming bowl|ramen noodles
🍲|pot of food|stew
🍛|curry rice|
🍣|sushi|
🍱|bento box|
🥟|dumpling|
🦪|oyster|
🍤|fried shrimp|
🍙|rice ball|onigiri
🍚|cooked rice|
🍘|rice cracker|
🍥|fish cake with swirl|
🥠|fortune cookie|
🥮|moon cake|
🍢|oden|
🍡|dango|
🍧|shaved ice|
🍨|ice cream|
🍦|soft ice cream|
🥧|pie|
🧁|cupcake|
🍰|shortcake|cake
🎂|birthday cake|
🍮|custard|pudding flan
🍭|lollipop|candy
🍬|candy|sweets
🍫|chocolate bar|
🍿|popcorn|
🍩|doughnut|donut
🍪|cookie|biscuit
🌰|chestnut|
🥜|peanuts|
🫘|beans|
🍯|honey pot|
🥛|glass of milk|
🍼|baby bottle|
🫖|teapot|
☕|hot beverage|coffee tea
🍵|teacup without handle|green tea
🧃|beverage box|juice
🥤|cup with straw|soda
🧋|bubble tea|boba
🍶|sake|
🍺|beer mug|
🍻|clinking beer mugs|cheers
🥂|clinking glasses|cheers champagne
🍷|wine glass|
🥃|tumbler glass|whisky
🍸|cocktail glass|martini
🍹|tropical drink|
🧉|mate|
🍾|bottle with popping cork|champagne
🧊|ice|
🥄|spoon|
🍴|fork and knife|
🍽️|fork and knife with plate|
🥣|bowl with spoon|
🥡|takeout box|
🥢|chopsticks|
🧂|salt|
`,
  Activities: `
⚽|soccer ball|football
🏀|basketball|
🏈|american football|
⚾|baseball|
🥎|softball|
🎾|tennis|
🏐|volleyball|
🏉|rugby football|
🥏|flying disc|frisbee
🎱|pool 8 ball|billiards
🪀|yo-yo|
🏓|ping pong|table tennis
🏸|badminton|
🏒|ice hockey|
🏑|field hockey|
🥍|lacrosse|
🏏|cricket game|
🪃|boomerang|
🥅|goal net|
⛳|flag in hole|golf
🪁|kite|
🏹|bow and arrow|archery
🎣|fishing pole|
🤿|diving mask|
🥊|boxing glove|
🥋|martial arts uniform|karate judo
🎽|running shirt|
🛹|skateboard|
🛼|roller skate|
🛷|sled|
⛸️|ice skate|
🥌|curling stone|
🎿|skis|
⛷️|skier|
🏂|snowboarder|
🪂|parachute|
🏋️|person lifting weights|
🤼|people wrestling|
🤸|person cartwheeling|
⛹️|person bouncing ball|
🤺|person fencing|
🤾|person playing handball|
🏌️|person golfing|
🏇|horse racing|
🧘|person in lotus position|
🏄|person surfing|
🏊|person swimming|
🤽|person playing water polo|
🚣|person rowing boat|
🧗|person climbing|
🚵|person mountain biking|
🚴|person biking|
🏆|trophy|winner
🥇|1st place medal|gold
🥈|2nd place medal|silver
🥉|3rd place medal|bronze
🏅|sports medal|
🎖️|military medal|
🏵️|rosette|
🎗️|reminder ribbon|
🎫|ticket|
🎟️|admission tickets|
🎪|circus tent|
🤹|person juggling|
🎭|performing arts|theatre
🩰|ballet shoes|
🎨|artist palette|art paint
🎬|clapper board|movie film
🎤|microphone|sing karaoke
🎧|headphone|music
🎼|musical score|
🎹|musical keyboard|piano
🥁|drum|
🪘|long drum|
🎷|saxophone|
🎺|trumpet|
🪗|accordion|
🎸|guitar|
🪕|banjo|
🎻|violin|
🎲|game die|dice
♟️|chess pawn|
🎯|bullseye|darts target
🎳|bowling|
🎮|video game|controller gaming
🕹️|joystick|arcade
🎰|slot machine|
🧩|puzzle piece|
🧸|teddy bear|
🪅|piñata|
🪩|mirror ball|disco
🪆|nesting dolls|
🎁|wrapped gift|present
🎀|ribbon|bow
🎊|confetti ball|party
🎉|party popper|celebrate tada
🎎|japanese dolls|
🏮|red paper lantern|
🎐|wind chime|
🧧|red envelope|
✉️|envelope|
🎈|balloon|party
🎏|carp streamer|
🎇|sparkler|
🎆|fireworks|
🧨|firecracker|
🎃|jack-o-lantern|halloween pumpkin
🎄|christmas tree|
🎋|tanabata tree|
🎍|pine decoration|
`,
  'Travel & Places': `
🚗|automobile|car
🚕|taxi|
🚙|sport utility vehicle|suv
🚌|bus|
🚎|trolleybus|
🏎️|racing car|f1
🚓|police car|
🚑|ambulance|
🚒|fire engine|
🚐|minibus|van
🛻|pickup truck|
🚚|delivery truck|
🚛|articulated lorry|
🚜|tractor|
🦯|white cane|
🦽|manual wheelchair|
🦼|motorized wheelchair|
🛴|kick scooter|
🚲|bicycle|bike
🛵|motor scooter|
🏍️|motorcycle|
🛺|auto rickshaw|tuk tuk
🚨|police car light|siren
🚔|oncoming police car|
🚍|oncoming bus|
🚘|oncoming automobile|
🚖|oncoming taxi|
🚡|aerial tramway|
🚠|mountain cableway|
🚟|suspension railway|
🚃|railway car|
🚋|tram car|
🚞|mountain railway|
🚝|monorail|
🚄|high-speed train|
🚅|bullet train|shinkansen
🚈|light rail|
🚂|locomotive|steam train
🚆|train|
🚇|metro|subway
🚊|tram|
🚉|station|
✈️|airplane|plane flight
🛫|airplane departure|
🛬|airplane arrival|
🛩️|small airplane|
💺|seat|
🛰️|satellite|
🚀|rocket|launch space
🛸|flying saucer|ufo
🚁|helicopter|
🛶|canoe|
⛵|sailboat|
🚤|speedboat|
🛥️|motor boat|
🛳️|passenger ship|cruise
⛴️|ferry|
🚢|ship|
⚓|anchor|
🛟|ring buoy|
⛽|fuel pump|gas petrol
🚧|construction|
🚦|vertical traffic light|
🚥|horizontal traffic light|
🚏|bus stop|
🗺️|world map|
🗿|moai|statue
🗽|statue of liberty|new york
🗼|tokyo tower|
🏰|castle|
🏯|japanese castle|
🏟️|stadium|
🎡|ferris wheel|
🎢|roller coaster|
🎠|carousel horse|
⛲|fountain|
⛱️|umbrella on ground|beach
🏖️|beach with umbrella|
🏝️|desert island|
🏜️|desert|
🌋|volcano|
⛰️|mountain|
🏔️|snow-capped mountain|
🗻|mount fuji|
🏕️|camping|tent
⛺|tent|
🛖|hut|
🏠|house|home
🏡|house with garden|
🏘️|houses|
🏚️|derelict house|
🏗️|building construction|crane
🏭|factory|
🏢|office building|
🏬|department store|
🏣|japanese post office|
🏤|post office|
🏥|hospital|
🏦|bank|
🏨|hotel|
🏪|convenience store|
🏫|school|
🏩|love hotel|
💒|wedding|
🏛️|classical building|
⛪|church|
🕌|mosque|
🛕|hindu temple|
🕍|synagogue|
🕋|kaaba|
⛩️|shinto shrine|torii
🛤️|railway track|
🛣️|motorway|highway
🗾|map of japan|
🎑|moon viewing ceremony|
🏞️|national park|
🌅|sunrise|
🌄|sunrise over mountains|
🌠|shooting star|
🎇|sparkler|
🌇|sunset|
🌆|cityscape at dusk|
🏙️|cityscape|city skyline
🌃|night with stars|
🌌|milky way|
🌉|bridge at night|
🌁|foggy|
`,
  Objects: `
⌚|watch|
📱|mobile phone|phone smartphone
📲|mobile phone with arrow|
💻|laptop|computer
⌨️|keyboard|
🖥️|desktop computer|
🖨️|printer|
🖱️|computer mouse|
🖲️|trackball|
🕹️|joystick|
🗜️|clamp|
💽|computer disk|minidisc
💾|floppy disk|save
💿|optical disk|cd
📀|dvd|
📼|videocassette|vhs
📷|camera|photo
📸|camera with flash|
📹|video camera|
🎥|movie camera|film
📽️|film projector|
🎞️|film frames|
📞|telephone receiver|call
☎️|telephone|
📟|pager|
📠|fax machine|
📺|television|tv
📻|radio|
🎙️|studio microphone|podcast
🎚️|level slider|
🎛️|control knobs|
🧭|compass|
⏱️|stopwatch|
⏲️|timer clock|
⏰|alarm clock|
🕰️|mantelpiece clock|
⌛|hourglass done|
⏳|hourglass not done|loading
📡|satellite antenna|
🔋|battery|
🪫|low battery|
🔌|electric plug|
💡|light bulb|idea
🔦|flashlight|torch
🕯️|candle|
🪔|diya lamp|
🧯|fire extinguisher|
🛢️|oil drum|
💸|money with wings|
💵|dollar banknote|money cash
💴|yen banknote|
💶|euro banknote|
💷|pound banknote|
🪙|coin|
💰|money bag|
💳|credit card|
🧾|receipt|
💎|gem stone|diamond
⚖️|balance scale|justice
🪜|ladder|
🧰|toolbox|
🪛|screwdriver|
🔧|wrench|spanner
🔨|hammer|
⚒️|hammer and pick|
🛠️|hammer and wrench|tools
⛏️|pick|
🪚|carpentry saw|
🔩|nut and bolt|
⚙️|gear|settings cog
🪤|mouse trap|
🧱|brick|
⛓️|chains|
🧲|magnet|
🔫|water pistol|gun
💣|bomb|
🧨|firecracker|
🪓|axe|
🔪|kitchen knife|
🗡️|dagger|
⚔️|crossed swords|
🛡️|shield|
🚬|cigarette|
⚰️|coffin|
🪦|headstone|grave
⚱️|funeral urn|
🏺|amphora|
🔮|crystal ball|
📿|prayer beads|
🧿|nazar amulet|evil eye
🪬|hamsa|
💈|barber pole|
⚗️|alembic|
🔭|telescope|
🔬|microscope|
🕳️|hole|
🩹|adhesive bandage|plaster
🩺|stethoscope|doctor
🩻|x-ray|
🩼|crutch|
💊|pill|medicine
💉|syringe|vaccine
🩸|drop of blood|
🧬|dna|
🦠|microbe|virus germ
🧫|petri dish|
🧪|test tube|
🌡️|thermometer|
🧹|broom|
🪠|plunger|
🧺|basket|
🧻|roll of paper|toilet paper
🚽|toilet|
🚰|potable water|
🚿|shower|
🛁|bathtub|
🛀|person taking bath|
🧼|soap|
🪥|toothbrush|
🪒|razor|
🧽|sponge|
🪣|bucket|
🧴|lotion bottle|
🛎️|bellhop bell|
🔑|key|
🗝️|old key|
🚪|door|
🪑|chair|
🛋️|couch and lamp|sofa
🛏️|bed|
🛌|person in bed|
🧸|teddy bear|
🪆|nesting dolls|
🖼️|framed picture|
🪞|mirror|
🪟|window|
🛍️|shopping bags|
🛒|shopping cart|
🎁|wrapped gift|
🎈|balloon|
🎏|carp streamer|
🎀|ribbon|
🪄|magic wand|
🪅|piñata|
🎊|confetti ball|
🎉|party popper|
🪩|mirror ball|
🎎|japanese dolls|
🏮|red paper lantern|
🎐|wind chime|
🧧|red envelope|
✉️|envelope|mail
📩|envelope with arrow|
📨|incoming envelope|
📧|e-mail|email
💌|love letter|
📥|inbox tray|
📤|outbox tray|
📦|package|box parcel
🏷️|label|tag
🪧|placard|sign
📪|closed mailbox with lowered flag|
📫|closed mailbox with raised flag|
📬|open mailbox with raised flag|
📭|open mailbox with lowered flag|
📮|postbox|
📯|postal horn|
📜|scroll|
📃|page with curl|
📄|page facing up|document
📑|bookmark tabs|
🧾|receipt|
📊|bar chart|
📈|chart increasing|
📉|chart decreasing|
🗒️|spiral notepad|
🗓️|spiral calendar|
📆|tear-off calendar|
📅|calendar|date
🗑️|wastebasket|trash bin
📇|card index|
🗃️|card file box|
🗳️|ballot box with ballot|vote
🗄️|file cabinet|
📋|clipboard|
📁|file folder|
📂|open file folder|
🗂️|card index dividers|
🗞️|rolled-up newspaper|
📰|newspaper|news
📓|notebook|
📔|notebook with decorative cover|
📒|ledger|
📕|closed book|
📗|green book|
📘|blue book|
📙|orange book|
📚|books|
📖|open book|read
🔖|bookmark|
🧷|safety pin|
🔗|link|chain url
📎|paperclip|
🖇️|linked paperclips|
📐|triangular ruler|
📏|straight ruler|
🧮|abacus|
📌|pushpin|pin
📍|round pushpin|location pin
✂️|scissors|cut
🖊️|pen|
🖋️|fountain pen|
✒️|black nib|
🖌️|paintbrush|
🖍️|crayon|
📝|memo|note write
✏️|pencil|
🔍|magnifying glass tilted left|search
🔎|magnifying glass tilted right|search
🔏|locked with pen|
🔐|locked with key|
🔒|locked|lock
🔓|unlocked|
🧳|luggage|suitcase travel
🌂|closed umbrella|
☂️|umbrella|
🧵|thread|
🪡|sewing needle|
🧶|yarn|
👓|glasses|
🕶️|sunglasses|
🥽|goggles|
🥼|lab coat|
🦺|safety vest|
👔|necktie|
👕|t-shirt|shirt
👖|jeans|
🧣|scarf|
🧤|gloves|
🧥|coat|
🧦|socks|
👗|dress|
👘|kimono|
🥻|sari|
🩱|one-piece swimsuit|
🩲|briefs|
🩳|shorts|
👙|bikini|
👚|woman's clothes|
🪭|folding hand fan|
👛|purse|
👜|handbag|
👝|clutch bag|
🎒|backpack|
🩴|thong sandal|
👞|man's shoe|
👟|running shoe|sneaker
🥾|hiking boot|
🥿|flat shoe|
👠|high-heeled shoe|
👡|woman's sandal|
🩰|ballet shoes|
👢|woman's boot|
🪮|hair pick|
👑|crown|king queen
👒|woman's hat|
🎩|top hat|
🎓|graduation cap|
🧢|billed cap|
🪖|military helmet|
⛑️|rescue worker's helmet|
📿|prayer beads|
💄|lipstick|
💍|ring|engagement
💼|briefcase|work
`,
  Flags: `
🇦🇺|australia|flag
🇦🇹|austria|flag
🇧🇪|belgium|flag
🇧🇷|brazil|flag
🇨🇦|canada|flag
🇨🇳|china|flag
🇩🇰|denmark|flag
🇪🇬|egypt|flag
🇫🇮|finland|flag
🇫🇷|france|flag
🇩🇪|germany|flag
🇬🇷|greece|flag
🇭🇰|hong kong|flag
🇮🇳|india|flag
🇮🇩|indonesia|flag
🇮🇪|ireland|flag
🇮🇱|israel|flag
🇮🇹|italy|flag
🇯🇵|japan|flag
🇰🇷|south korea|flag
🇲🇾|malaysia|flag
🇲🇽|mexico|flag
🇳🇱|netherlands|flag
🇳🇿|new zealand|flag
🇳🇬|nigeria|flag
🇳🇴|norway|flag
🇵🇰|pakistan|flag
🇵🇭|philippines|flag
🇵🇱|poland|flag
🇵🇹|portugal|flag
🇷🇺|russia|flag
🇸🇦|saudi arabia|flag
🇸🇬|singapore|flag
🇿🇦|south africa|flag
🇪🇸|spain|flag
🇸🇪|sweden|flag
🇨🇭|switzerland|flag
🇹🇼|taiwan|flag
🇹🇭|thailand|flag
🇹🇷|turkey|flag
🇺🇦|ukraine|flag
🇦🇪|united arab emirates|flag
🇬🇧|united kingdom|flag uk britain
🇺🇸|united states|flag usa america
🇻🇳|vietnam|flag
🇪🇺|european union|flag eu
🇺🇳|united nations|flag
`,
};

export const SKIN_TONES = [
  { id: '', label: 'Default', swatch: '#ffcc22' },
  { id: '\u{1F3FB}', label: 'Light', swatch: '#f7d7c4' },
  { id: '\u{1F3FC}', label: 'Medium-light', swatch: '#e3b98f' },
  { id: '\u{1F3FD}', label: 'Medium', swatch: '#c88e62' },
  { id: '\u{1F3FE}', label: 'Medium-dark', swatch: '#a05f2c' },
  { id: '\u{1F3FF}', label: 'Dark', swatch: '#5c3a1e' },
];

export const CATEGORIES = Object.keys(RAW);

// A few emoji belong in two groups; each one is listed once, in the first.
const seen = new Set();

export const EMOJI = CATEGORIES.flatMap((category) =>
  RAW[category]
    .trim()
    .split('\n')
    .map((line) => {
      const [char, name, extra = ''] = line.split('|');
      const tone = extra.endsWith('*');
      return {
        char,
        name,
        category,
        tone,
        search: `${name} ${tone ? extra.slice(0, -1) : extra}`.toLowerCase(),
      };
    }),
).filter((entry) => !seen.has(entry.char) && seen.add(entry.char));

// Adds a skin tone modifier after the base character, where the emoji takes one.
export function withTone(entry, tone) {
  if (!tone || !entry.tone) return entry.char;
  const chars = [...entry.char];
  // The tone goes right after the first character, before any variation
  // selector or joiner that follows it.
  const rest = chars.slice(1).filter((c) => c !== '️');
  return chars[0] + tone + rest.join('');
}
