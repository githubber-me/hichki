# Hichki

**Kisi ne yaad kiya.** Someone remembered you.

---

Every festive gathering has an empty chair.

It belongs to the sister whose visa didn't come through in time. The son working a night shift in another country. The grandfather who is too unwell to travel. The cousin who couldn't afford the ticket home this year.

Today, the most they can do is join a video call and watch. They see the room, but the room carries on without them. Nobody can hand them a plate. They can't ask for anything. They're watching a party, not part of it. And the family WhatsApp group fills up with three hundred forwarded photos, none of them the one they wanted.

Hichki gives the person who couldn't come a real place at the gathering, using just their voice.

## What it feels like

Priya's sister is in Toronto. It's 4 in the morning there, and Priya's wedding is happening in Jaipur.

She opens a link on her phone and says, in Hindi, *"Show me Dadi when she sees the bride."*

Every phone at the wedding lights up with her request. Three cousins rush to send a photo. She picks the best one, and that cousin goes to the top of the leaderboard.

During the toast, someone taps one button. Her phone buzzes in Toronto: *kisi ne yaad kiya*.

When the cake is cut, a voice letter she recorded last week unlocks and plays for the whole room.

She wasn't there. But she was part of it.

## What you can do

**Be my eyes.** Ask the room to show you something. "Show me the mehendi." "Show me Papa dancing." Everyone at the gathering can answer, and you pick the photo you love most. Then you can say thank you, in a line, a voice note or a quick video, and it reaches them straight away.

**Meri taraf se** (on my behalf). Ask someone to do something for you, and get proof back. "Touch Nani's feet for me." "Light a diya for me at the temple."

Not sure what to ask? There are ideas ready for every occasion, one tap away: *"Send me a photo of the mehendi on the bride's hands."* On a trip: *"Send me a group photo, and leave a gap for me."*

**Hichki** (hiccup). Anyone at the gathering can tap one button to let you know you were just thought of. In India, people say a hiccup means someone is remembering you. Now it's real. And it goes both ways: you can send a hichki back to one person, by name.

**Jab kholna** (open when). Record voice letters ahead of time that stay locked until a moment happens. "Open when the cake is cut." "Open when Dadi starts crying." The room unlocks it by showing that the moment came.

**Dadi ki kahani** (grandma's story). Ask for a story, and someone hands Dadi the phone. She tells it in her own language. Punjabi, Kannada, Bengali, any of them. Family anywhere in the world can hear her voice and read the story in the language they understand.

**Yaadein** (memories). When the celebration ends, nothing disappears. The host taps "wrap up", and the same link you used all week opens on one page: everything you asked for and what came back, the letters that opened, Dadi's story, and a dot for every single time someone thought of you. Tap once and it plays back from the first day to the last. You can send that page to anyone, and they can only look.

## How people use it

**If you're hosting,** you create the gathering in a few seconds. You get a QR code to put on the table and a private link to send the person who couldn't come.

**If you're at the gathering,** you scan the QR code and type your name. There's no app to download and no account to make.

**If you'd rather know exactly who's in,** turn on *Only verified guests*. Everyone then signs in with Google or their phone number, so nobody can join under someone else's name. The host can remove anyone, at any time, and everyone can change their name or photo whenever they like.

**If you couldn't come,** you open your link and talk. That's it.

## Set it up once, for the whole celebration

A wedding isn't one evening. It's the haldi, the mehendi, the sangeet, the pheras and the reception, spread over days.

So Hichki lasts as long as the celebration does. On Wednesday, Meera can sit down once and plan her whole week:

- Thursday morning: *"Show me the haldi."*
- Friday at 1 PM: a voice message for the couple, played at lunch.
- Saturday at the sangeet: *"Get Papa on the dance floor, and send me proof."*

Each one appears at the gathering exactly when she wanted it to. Her link keeps working all week, and so does everyone else's.

## Not just weddings

Hichki works for any gathering where someone is missing: Diwali at home, Christmas dinner, New Year's Eve, Eid, a family trip, a birthday.

It also works for the people who keep the world running while everyone else celebrates. The nurse on a night shift. The soldier at a posting. The delivery rider working through the holiday. We call this **Duty pe** (on duty). One tap tells the room you're on a shift until 6 AM. Nothing buzzes you at work: every hichki is kept, and when your shift ends you see who thought of you, and what you missed, first. They can't be there, but they don't have to miss it.

The room always knows what time it is for you, too: *"It's 4:12 am for Meera in Toronto."*

## What we built today

Hichki was built from scratch, in one day, at [Festive Hacks](https://www.wemakedevs.org/hackathons/festivehacks) in Bengaluru on 25 November 2026. These were the goals, and all of them work:

- [x] People join a gathering by scanning a QR code, with no app and no sign-up
- [x] The person who couldn't come speaks a request in their own language, and it appears on every phone
- [x] Requests and messages can be planned days ahead and appear on their own
- [x] The room sends photos and voice notes back, the best one wins points, and a thank-you comes back
- [x] One tap sends a hichki across the world, and one comes back
- [x] Voice letters unlock when their moment comes
- [x] An elder's story can be asked for, heard and read in another language
- [x] Someone on duty gets everything they missed, the moment their shift ends
- [x] When it's over, everything that happened is kept on one page to relive and share
- [x] Hosts who want to know exactly who's in can ask guests to sign in

## Made with

**[Sarvam AI](https://www.sarvam.ai)** listens. It turns a request spoken in Hindi, Hinglish or any Indian language into a short card the whole room can read, and it knows a story request from a photo request. It writes down Dadi's story in the language she told it, and translates it, so a grandmother in Amritsar and a grandson in London can understand each other.

**[Flagsmith](https://www.flagsmith.com)** lets the celebration change while it's happening. Hichki, voice letters and voice requests can each be switched off from Flagsmith, and every phone in the room changes within seconds. The ideas for each occasion live in Flagsmith too, so they can be rewritten for a new festival without touching the app.

**[NudgeBee](https://nudgebee.com)** keeps watch over the server. To test it, we broke photo uploads on purpose. Asked "why are photo uploads failing?", NudgeBee worked through the logs, events and deployment history on its own, and in about eight minutes named the exact change that caused it. It also checked the storage and ruled it out, so it didn't just guess the obvious answer.

**[Clerk](https://clerk.com)** handles the optional Google and phone sign-in for verified gatherings.

## What it costs

The AI part costs almost nothing per family. Turning a spoken request into a card costs about 10 paise. A 30-second story, written down and translated, costs well under a rupee. A whole wedding weekend with fifty requests and ten stories comes to roughly ₹13 in Sarvam usage.

## Your memories stay yours

The photos, voices and stories shared at a gathering are kept on our own server, not on a social network. Voice recordings are sent to Sarvam AI only so they can be written down and translated. Only people with the gathering's link can see it, the host can remove anyone, and the page you share at the end only lets people look.

## What's next

- Each guest reading every request in their own language, not just the stories.
- Notifications that reach a phone even when Hichki isn't open.
- A printed table card with the QR code, for the host to put out.
- An experiment, already wired to Flagsmith, on whether asking one named cousin gets a request answered faster than asking the whole room.

## For builders

To run Hichki yourself, on a laptop or on Kubernetes, follow [docs/setup.md](docs/setup.md). How it's put together is in [ARCHITECTURE.md](ARCHITECTURE.md), and every route is in [docs/api.md](docs/api.md).

## How it was made

Hichki was built in one day with Claude, Anthropic's AI coding assistant, writing much of the code alongside a person who decided what to build, chose every feature and cut, tested it on real phones, and reviewed what shipped.

The paintings are in the style of Warli, the wall art of the Adivasi communities of Maharashtra's north Sahyadri range, which is where the circle of dancers comes from. They were made with an AI image model for this project, not copied from any artist's work.
