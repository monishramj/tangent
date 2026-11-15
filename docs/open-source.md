# Open-source cleanup notes

Owner checklist. This file does not decide any legal question.

## Anthropic terms for `claude -p`

Tangent shells out to the installed `claude` CLI (`claude -p`). Whether that is allowed inside a distributed app is **for the owner to verify** against the current terms. Nothing below is a conclusion.

Read:

- Claude Code legal and compliance (products that run Claude Code, OAuth vs API key, names and logos, “ordinary, individual usage”): https://code.claude.com/docs/en/legal-and-compliance
- Consumer Terms (Free, Pro, Max, Ultra), including any restriction on automated or third-party access: https://www.anthropic.com/legal/consumer-terms
- Commercial Terms (API, Team, Enterprise): https://www.anthropic.com/legal/commercial-terms
- Usage policy (linked from the compliance page as the acceptable-use rules): https://www.anthropic.com/legal/aup

Questions to answer from those pages, not from this repo:

1. Does a desktop app that launches the unmodified `claude` binary “offer Claude Code in a product”? The compliance page has a section titled “Can customers offer Claude Code in their products?”
2. Which contract applies for a user who is already logged in with Free, Pro, Max, or Ultra, versus a user on an API key or a Team or Enterprise plan?
3. May the app depend on that user’s existing Claude Code login, or does each user have to authenticate with an API key (or Bedrock, Google Cloud’s Agent Platform, or Microsoft Foundry)? See “Authentication and credential use” on the compliance page.
4. Does invoking `claude -p` and showing the result count as paying for, reselling, or intermediating Claude usage?
5. Do the Consumer Terms restrict automated access or third-party harnesses in a way that covers this app?
6. Do Pro, Max, and Ultra usage limits that assume “ordinary, individual usage” cover generating lesson videos?
7. What may the README and UI say about Claude Code and Anthropic names or logos? The compliance page covers plain-text mention versus branding.
8. Do the Commercial Terms’ restrictions on competing products apply to this app?

## Git history

`sidecar/tests/fixtures/stat350_ch5_ir.json` and the course-page screenshots listed in the packaging log were removed from the tree with `git rm`. They are still in older commits. Rewriting history to purge them is an owner decision (plan step 24, “Before release”). Do not force-push that rewrite without an explicit yes.

Spike scripts under `spikes/pdf/` still contain short benchmark notes that quote course PDFs. Those files are code, not the PDFs. Deleting or rewriting the notes is the same owner decision.
