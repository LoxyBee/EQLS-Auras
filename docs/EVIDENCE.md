# Lockouts — evidence log

`src/main/lockoutCore.js` is deliberately free of hardcoded reset days and
invented line shapes. This file records where each fact it relies on came from,
so the next person to touch it can check the reasoning rather than trust a
constant. Where a claim has not been verified, that is said plainly.

## There is no raid-lockout line

EverQuest Legends does not print a "you are locked out until…" message. This was
checked against our own captured logs (`eqlog_*.txt`) and the client string
table (`<install>/eqstr_us.txt`). Nothing matches.

What the game *does* print, on a boss kill that advances a weekly, is a weekly
**task** by name plus the reward hand-off:

```
You have been assigned the task 'Potential of the Void - Lord Nagafen - Weekly'.
Your task 'Potential of the Void - Lord Nagafen - Weekly' has been updated.
You have been given: Void-Touched Potential
```

The parser keys off those lines and the kill lines around them. It never infers
a lockout from kill history alone.

## The reset day is not hardcoded

`projectReset()` reports `provenance: 'not recorded'` until it has seen the same
weekly task assigned on opposite sides of a turnover. There is no default reset
constant in the parsing core.

Context for why this matters: the two other published implementations of a
lockout tracker for this content both ship a typed **Tuesday** reset, and one
marks it "VERIFY IN GAME" in its own source. We treat that as a hint, not a
fact.

Separately, the *host* side (`easternReset.js` / `logRotation.js`) carries a
user-editable reset setting that defaults to **Tuesday 11:00 US Eastern**. That
default is the app's own operational choice for log rotation, stated by the
owner first-hand (23 Aug 2026), and is independent of the parsing core's
"not recorded" stance — the core still won't claim a boundary it hasn't seen.

## Line shapes

Every regex in the "Line shapes" section of `lockoutCore.js` was read off a real
line in our logs or off `eqstr_us.txt`. None was copied from another project.

## One grid cell per raid

The grid shows one cell per raid, which is only strictly correct if all bosses
in a raid share a single lock. The alt+Z lockout window is *consistent* with
that but does not prove it — the bosses appeared together because they were
killed together, which is also what five separate locks started at the same
moment would look like.

The observation that would separate the two models is a run that clears only
*some* of a zone's bosses followed by evidence about the rest. Our corpus is not
known to contain one. If the models ever diverge in play, a single cell would
hide it — this is a known limitation, not a settled fact.
