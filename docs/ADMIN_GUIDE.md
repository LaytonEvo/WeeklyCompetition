# Staff & manager guide

Sign in at **/admin/login**. Your menu shows only what your role allows.

| Role | Can |
|---|---|
| **Staff** | Live rounds, check-ins, walk-in entries with in-store payment, record and correct shots in live rounds, flag hole-in-ones, upload evidence, add customer notes |
| **Manager** | Everything Staff can, plus: create, approve and edit competitions; availability; complimentary entries; correct verified scores; disqualify; review hole-in-ones; finalise results; record prize payments; refunds; reports; customer edits, merges and exports |
| **Marketing** | Reports (without financial detail), campaign links and QR codes, approved public results, the consented-audience export |
| **Super Admin** | Everything, plus settings, the legal launch gate, jackpot funding and staff users |

## At the counter (Live rounds)

Keep **/admin/live** open on the counter tablet. It refreshes itself every 15 seconds.

**Booked customer arrives**
1. Type their 8-character booking code (or tap the scan icon and scan their QR), then **Check in**. Alternatively, tap **Check in** next to their name under *Today's bookings*.
2. Their round opens on the right. Tap **Start round**.

**Walk-in customer**
1. **Add walk-in entry** → search name, email or mobile. If they've played before, pick them; their unused paid rounds are offered first, so they won't pay twice.
2. New customer: enter name, email and mobile. Read them the rules and tick the two confirmations. Only tick marketing if they say yes.
3. Choose rounds and payment: *Card (terminal)* or *Cash*. Type the terminal receipt or auth code. Managers can choose *Complimentary* with a reason.
4. **Create entry & check in**, then **Start round**. Pressing the button twice is safe and never creates two entries.

**Recording shots**
- Type the distance in metres on the keypad (e.g. `1.34`) and tap **Record shot N**. A physical keyboard and Enter also work.
- Toggle **On the green** off if the ball finished off the green. It's recorded but won't count if the rules require the green.
- **Valid shot** off = the shot doesn't count (mis-hit, simulator mis-read and so on). **No result / missed** = no distance.
- The *Current best* updates as you go.
- **Correct** a shot if you mistyped. You must give a reason; the original is kept in the audit history. Only managers can correct a round that has already been verified.
- Mistyped the shot you just entered? Use **Correct → Undo this shot**.
- If the connection drops, nothing is lost. Press the button again; the system recognises a repeat.

**Finishing**
- After the last shot, tap **Complete & verify round**. The leaderboard and TV update within a couple of seconds and the player is emailed their result.
- Player has to leave early? **Finish early…** with a reason. Remaining shots are forfeited.
- Simulator froze or crashed? **Simulator problem — restart**. The round is voided (kept for the record) and a fresh replacement round is issued against the same payment. For a short interruption use **Pause** and **Resume**.
- Afterwards, if they're interested in clubs, tap **Interested in a fitting**. This logs a fitting enquiry for follow-up and reporting.

**Hole-in-one!**
1. Tap **Hole-in-one!**, describe what you saw (plus a second witness if there is one) and record the shot.
2. **Immediately** photograph or screenshot the simulator screen with the camera icon on that shot.
3. It does not count, and nothing is promised to the player, until a manager *who did not witness it* approves it under **Hole-in-one claims**.

## Managers

**Weekly cycle**
1. Each week the scheduler drafts upcoming competitions from the template (Competitions › Weekly templates). Review the draft: hole, simulator settings, prizes, jackpot and rules.
2. Resolve anything listed under *Cannot be published yet*, then **Approve & publish**. It opens automatically at its start time.
3. During the week, deal with hole-in-one claims promptly.
4. It closes automatically at the deadline. Rounds already in progress can still be finished.
5. Go to **Competitions › Results**. Once no rounds or claims are outstanding, check the standings (full names shown), record any playoff result if the tie policy is *playoff*, then **Finalise results**. Winners are emailed automatically.
6. Under **Winners & prizes**, mark prizes *claimed*, then *fulfilled* with the amount, method and transaction reference. Prize money is paid manually, never through Stripe.

**Changing a live competition.** Scoring rules, entry fee, shots per round, entry mode, tie procedure and start time are locked once entries exist. Prizes and the jackpot can only go up, and the deadline can only be extended. Each change needs a reason, is versioned, and is emailed to entrants.

**Cancelling.** Use *Cancel competition* with a reason; entrants are emailed. Then refund unplayed paid entries under **Payments**.

**Availability.** Add fitting appointments as one-off or weekly blocks. If the simulator breaks, untick *Simulator available* so online booking stops offering slots. New blocks don't cancel existing bookings — check **Bookings** and move or cancel them with the customer.

**Bookings.** Move a booking for late arrivals or reschedules. No-shows are marked automatically after the grace period, and their paid rounds stay available for another visit within the same competition.

**Refunds.** Under **Payments › Refund**, card payments are refunded via Stripe; cash and terminal refunds are recorded after you've made them. You can cancel unplayed rounds at the same time. Each refund form submits once only.

**Customers.** Search, edit, add notes and log fitting enquiries. **Merge** duplicates from the profile you want to keep. **Export data** answers subject access requests. **Erase** (Super Admin) handles erasure requests: results stay as "Former player" and financial records are retained.

## Situations you'll meet

| Situation | What to do |
|---|---|
| Customer arrives late | Check them in if the bay is free; otherwise move the booking (Bookings) or start their paid round later the same week. |
| Customer doesn't come | Marked no-show automatically; their entry remains usable within the competition. |
| Paid online but the slot was taken while paying | The system refunds automatically and emails them. Check **Payments › Reconciliation** for anything flagged. |
| Customer paid twice | Refund the duplicate payment and cancel its unplayed rounds. |
| Wrong score entered | **Correct** with a reason (manager if already verified). |
| Two identical scores | Handled by the tie procedure published before opening. Never invent a tie-break afterwards. |
| Two hole-in-ones | Both tie at 0.00 m. Jackpot caps decide payouts and are checked automatically in approval order. |
| Round finishing right at the deadline | Rounds started before the deadline can be completed. |
| Internet drops | Retry the same button — submissions are de-duplicated. The TV keeps showing the last data and reconnects automatically. |
| Winner can't be contacted | The prize expires automatically after the claim deadline (it can be reopened). Add notes of your attempts. |
| A result is disputed | Don't finalise. Check the audit log and evidence, correct if justified, then finalise. |

## Shop TV

Open **/tv** full-screen on the TV browser (F11) and leave it running. It rotates between the top 10, the weekly prize, the jackpot, the countdown and the featured hole, updates live, reloads itself every 30 minutes, and never shows contact details.
