# Oddly, Inc.

> We looked at that and said: this can be improved.

The website of Oddly, Inc., a fictional and extremely confident technology company run by CEO Stephen Stubborn (pronounced "Stefen Stu-Born") and CFO Stephen Stupid (no relation). Every product has its own page, most of them do something when you click on them, and every one of them is Certification: Pending.

Live at **[oddly-inc.com](https://www.oddly-inc.com)**.

## What's here

The site is plain static HTML. Each page is a single self-contained file with its own CSS and JavaScript, and there is no build step. The homepage (`index.html`) lists everything: the catalog of product sites, the software, the downloads, and the keynote film.

### Product sites

| Page | Product | Category |
|---|---|---|
| `cars.html` | Oddly Cars: Front-Front, Back-Back, Oddly Autonomous™ | Mobility |
| `roadster.html` | Oddly Roadster: eight seats, thirteen rockets | Mobility |
| `cars-app.html` | Oddly Cars App, version 1.0.4 | Mobility |
| `elevator.html` | Oddly Elevators | Facilities |
| `human.html` | Oddly Human 1: Precision Force Delivery™ | Robotics |
| `pool.html` | Oddly Pool Cleaner | Home |
| `nukemow.html` | Oddly NukeMow™ | Home |
| `acid.html` | Oddly Acid™ | Labs |
| `ahctpac.html` | ahctpac, the reverse CAPTCHA | Labs |
| `park.html` | oAction Park | Entertainment |
| `shmock.html` | Tickelish Shmock | Social |
| `plane-pressurizer.html` | Oddly Plane Pressurizer | Travel |
| `terafab.html` | Oddly Terafab, Santa Barbara, CA | Manufacturing |
| `hair-lubricator.html` | Oddly Hair Lubricator | Personal Care |
| `now.html` | Oddly NOW™ Series: NOW Toaster and NOW Kettle | Kitchen |
| `otag.html` | oTag | Accessories |
| `osiri.html` | oSiri 2.0 (beta) | AI |
| `ojacket.html` | oJacket | Apparel |
| `journey.html` | The Journey of Oddly: essay and timeline | Corporate |

### Software

| File | What it is |
|---|---|
| `oos.html` | oOS 2.0, the oPhone 1 operating system, with the oStore, Oddly Brain, widgets and companion apps |
| `oddlyos.html` | Oddly OS, the desktop operating system |
| `war.html` | Iron Meridian, a real-time strategy game (also at war.oddly-inc.com) |

### Companion apps

These are phone-sized apps that open on their own or inside oOS 2.0. Adding `?oos=1` to the URL gives the embedded layout that oOS uses.

| File | Companion to |
|---|---|
| `Oddly-Cars-App-1.0.4.html` | Oddly Cars and the Roadster |
| `Oddly-Human-App.html` | Oddly Human 1 |
| `oPressure-App.html` | Plane Pressurizer |
| `NukeMow-App.html` | NukeMow™ |
| `OPC-Command-App.html` | Pool Cleaner |
| `Hive-App.html` | Hair Lubricator |
| `NOW-App.html` | NOW™ Series |
| `Oddly-Find-App.html` | oTag |

### Other files

- `index.html`: the homepage.
- `404.html`: the "Page Decommissioned" page.
- `lorem.html`: Lorem Ipsum (served at lorem.oddly-inc.com).
- `book.pdf`: The Oddly Book.
- `interview.md`: the oPhone 1 launch interview.
- `media/oddly-keynote.mp4` and `media/oddly-keynote-poster.jpg`: the 1:51 keynote film on the homepage. It is 3D rendered with an original soundtrack and runs from the Roadster to the oSiri 2.0 finale.
- `terafab-3d.js` and `terafab-entrance.jpg`: assets for the Terafab page.
- `favicon.svg`: the Oddly logo.
- `vercel.json`: subdomain routing (see below).

## Running it locally

There is nothing to install. Serve the folder over HTTP so that pages which load other files (the oOS companion apps, the Terafab 3D model, the film) work:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment

The site is hosted on [Vercel](https://vercel.com) as a static site and deploys automatically when `main` changes. `vercel.json` maps the subdomains:

| Subdomain | Serves |
|---|---|
| `lorem.oddly-inc.com` | `lorem.html` |
| `ahctpac.oddly-inc.com` | `ahctpac.html` (the path `/ahctpac.html` on the main domain redirects home) |
| `war.oddly-inc.com` | `war.html` |

## Adding a product

1. Create `<product>.html` in the house style:
   - Colors: `#080A14` background, `#7B4FFF` purple, `#2EE9A5` mint, `#F5A623` amber.
   - Fonts: Fraunces, Space Grotesk and JetBrains Mono.
   - The official logo in the header, linking to `/`.
   - A "Certification: Pending" badge, and the sign-off "This is not a bug. — Oddly, Inc."
2. Add it to the `SITES` list in `index.html`. If it has a companion app, also add the app to `DOWNLOADS`.
3. Add a timeline entry and a footer mention in `journey.html`.
4. If there is a companion app, register it in `oos.html` in three places: `WEB_APPS`, `STORE_CATALOG`, and the Oddly Account device map.

## Saved data

Several pages remember things in your browser's `localStorage`: oSiri's one prompt, the oPhone passcode and setup, Oddly OS users and high scores, the Roadster's paint color, and app settings. Nothing is sent to a server. To start fresh, open a private window or clear the site data for oddly-inc.com.

---

© Oddly, Inc. All products are fictional. Certification: Pending.
