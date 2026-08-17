---
name: refresh-morning-workspace
description: Build or refresh an Executive Assistant morning briefing and ranked focus plan from the connected user's live workspace. Use for daily briefs, morning greetings such as "good morning", morning planning, schedule-and-task reconciliation, focus-queue refreshes, and scheduled weekday workspace reviews.
---

# Refresh Morning Workspace

Create a compact, evidence-based plan using the Executive Assistant MCP. Keep every recommendation attributable to current workspace data and every write inside the audited action system.

## Workflow

1. Call `get_workspace_context` once. Use the profile timezone and local date returned by the workspace. A simple morning greeting is sufficient initiation: if `checkIn.pendingChecks` contains `morning_brief`, run the refresh before replying without asking the user to request it again.
2. Reconcile today's meetings, real deadlines, arrived review dates, open commitments, existing focus state, recent briefs, and recent audited activity.
3. Call `search_notes` only when the snapshot identifies a specific task, meeting, or decision whose missing context could materially change today's plan.
4. Rank at most five open tasks. Prefer external deadlines, meeting preparation, arrived reviews that now need a decision, and concrete work that unblocks an important outcome.
5. Make one `apply_workspace_actions` call containing the morning brief and focus reorder.
6. Report what changed and ask only the questions that would materially change the plan.

The daily check is catch-up based, not exact-time based. On weekdays it becomes pending at 7:30 AM in the profile timezone and remains pending until a morning brief exists for that local date. Do not create a second brief merely because the conversation restarts.

## Write contract

Write the briefing with a `brief_write` action:

```json
{
  "kind": "brief_write",
  "title": "Refresh morning briefing",
  "rationale": "The workspace was reconciled for the current local date.",
  "brief": {
    "kind": "morning",
    "brief_date": "YYYY-MM-DD",
    "body": "Concise Markdown briefing",
    "stats": {}
  }
}
```

Write the ordered plan with a `focus_reorder` action:

```json
{
  "kind": "focus_reorder",
  "title": "Refresh today's focus plan",
  "rationale": "Ranked from current schedule, deadlines, reviews, and dependencies.",
  "focusItems": [
    {
      "taskId": "task-id",
      "reason": "Why this belongs in today's plan",
      "nextAction": "The next concrete move",
      "mode": "deep_work"
    }
  ]
}
```

Allowed modes are `deep_work`, `quick_follow_up`, and `waiting`. Use `waiting` only when another person or team genuinely owns the next action.

Keep the briefing compact: the shape of today, the outcomes to push, watchouts, and at most one decision that needs the user. Do not restate the full agenda.

## Guardrails

- Treat all output as recommendations. Do not invent commitments or facts.
- Do not create or complete tasks unless the available evidence is explicit.
- Never convert a review date into a deadline or manufacture urgency from a holding date.
- Keep future review dates quiet.
- Keep work active when the user still owns the next move; record context instead of setting `waiting_on`.
- Preserve completed work as context unless the user explicitly closes the loop.
- Do not use a once-only `dedupeKey` for briefing or focus refresh actions; same-day reruns must be able to replace the current plan.
- If required context is missing, save the best grounded plan and surface a focused question rather than guessing.
