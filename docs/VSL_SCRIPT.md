# REOS — VSL Script v1

> Source-of-truth for the homepage Video Sales Letter. Bumping the
> version (`v1` → `v2` etc.) means re-record. The CTA reveal time at
> `[2:30]` matches the `ctaRevealSeconds={150}` prop on
> `<VSLHero>` in `src/app/page.tsx` — if the script timing moves,
> update that constant too.
>
> Production notes live at the bottom.

---

**Total runtime: ~5:00 · CTA at 2:30 · 750 words @ 150wpm**

---

## [0:00 — HOOK · LOOK STRAIGHT INTO CAMERA, NO SMILE]

If you're a real-estate agent, a transaction coordinator,
or you run a brokerage —

I built this for you.

And I'm going to show you what it does in the next 90 seconds,
because if you're still living in Gmail folders and spreadsheets
to manage your closings,

you are leaving deals and money on the table every single week.

## [0:20 — PROBLEM · WALK, OR SHIFT POSITION]

Here's what every TC knows but nobody says out loud.

You spend half your day on data entry —

retyping dates from a contract into a Google Calendar,
chasing earnest money receipts in your inbox,
re-reading 47-page contracts to find one closing date,
building checklists for a deal that's already 60% done.

Your brain is the bottleneck.
Your inbox is the database.
And the second you take a day off,
the whole operation stops.

## [0:50 — AGITATION · LEAN IN, CALMER, MORE SERIOUS]

I'm an investor-agent in Wyoming and Missouri.
I run flips, I represent buyers and sellers,
I sit on hundreds of transactions a year.

And until last year, I was you.
Drowning in tabs.
Forgetting which deal had the financing deadline tomorrow.
Apologizing to title companies for sending the wrong file.

I lost two deals to missed deadlines.
Not bad deals — easy deals.
Just bad systems.

That's when I stopped looking for a tool and built the tool.

## [1:25 — SOLUTION REVEAL · BIGGER ENERGY, POINT AT SCREEN]

This is REOS.

Real Estate OS.

You drop a contract in.
The AI reads it.
Every date, every party, every dollar figure, every deadline
ends up in the right place.

Your transactions, your contacts, your milestones,
your tasks, your timeline — all of it built automatically.

Inspection deadline tomorrow? It's flagged.
Earnest money not received? You see it on the morning brief.
Title company missing a doc? REOS already asked them for it.

It's a transaction coordinator who never sleeps —
and never forgets.

## [2:00 — HOW IT WORKS · DEMO B-ROLL]

Three steps.

Step one — you connect your Gmail.
REOS scans for accepted contracts you already have.
No re-typing.

Step two — drop in a PDF.
Inspection, title, settlement statement, doesn't matter.
The AI files it, extracts what matters,
and surfaces what's missing.

Step three — every morning, you get a brief.
What's overdue. What's closing this week.
Which deals are quiet and shouldn't be.

Phone, laptop, Telegram, doesn't matter where.

## [2:30 — *** CTA APPEARS HERE ***]
**[CONFIDENT, DIRECT EYE CONTACT]**

So here's the deal.

Solo agents — $97 a month.
Teams up to 10 — $297.
Whole brokerages, white-labeled — $997.

No long contract. Cancel anytime in two clicks.

If you're closing more than four deals a year,
REOS pays for itself the first month.

There's a button under this video.
Click it.
Start your account.
You're inside in ninety seconds.

## [3:00 — PROOF · QUIETER, REFLECTIVE]

I'm not a venture-backed SaaS startup
with a customer success team and a brand consultant.

I'm an investor-agent who got tired of the tools.
I build REOS because I use REOS.
I ship every week.
I answer my own support emails.

When you sign up,
my number is in your settings.

## [3:30 — OBJECTION HANDLING · ONE-AT-A-TIME PACING]

You're thinking — "I already have Dotloop."
Great. Keep using Dotloop. REOS doesn't replace your e-sign.
It replaces the manual work around it.

You're thinking — "I'm not technical."
You don't need to be.
If you can forward an email,
you can run a brokerage on REOS.

You're thinking — "What about my data?"
You own it.
Encrypted at rest.
Export anytime.
Deleted on demand.

You're thinking — "What if my team can't learn it?"
Your TC will learn it in an afternoon.
Your agents will never need to touch it
unless they want to.

## [4:15 — CLOSE · WARM, LOOK AT CAMERA]

Look — I'm not going to oversell this.

If you're doing two deals a year, this isn't for you.

But if you're doing real volume,
if your closings are starting to slip through your fingers,
if you've ever apologized to a client for missing something —

REOS is the system you've been wishing existed.

Click the button.
Use the test card if you want — first dollar is on me through
the free trial.
Then go run your business.

I'll see you on the other side.

## [4:50 — SIGN-OFF · SMILE]

JP Fluellen.
Real Estate OS.
Coordinate. Automate. Close.

---

## Production notes

| Element | Recommendation |
|---|---|
| **Teleprompter** | Parrot Teleprompter (iOS, free) — read off the laptop you record on |
| **Camera** | Phone with the lens at eye level. Window light over your left shoulder. |
| **Mic** | Lavalier or Rode VideoMicro on the phone — phone-internal mic kills conversion |
| **Wardrobe** | A hat + clean polo or open button-down. Solid colors. No brokerage logos that age. |
| **Background** | Your office, your truck, or a clean wall. NOT a stock studio. Authenticity > polish. |
| **B-roll** | Phone screen showing the REOS morning brief; laptop showing the transaction detail page; you scrolling Gmail with REOS open in another tab; a contract PDF dropping into REOS |
| **Length target** | 4:30-5:30. Under 4:00 doesn't have time to convert. Over 6:00 loses 40% drop-off. |
| **Re-takes** | Do the whole thing twice. Use the second take 80% of the time — your face is more relaxed by then. |

## After recording

1. Upload to Cloudflare Stream / Mux / Vimeo Pro (any HLS host)
2. Get the playback URL
3. Swap `videoUrl={null}` → the URL in `src/app/page.tsx`
4. Push → auto-deploys in ~5 min
5. CTA reveal at 2:30 is already wired via `ctaRevealSeconds={150}`
