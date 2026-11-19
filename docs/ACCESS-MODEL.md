# AE Library access model

Status: **decided with the product owner on 2026-11-18**, except the items under "Open items". Business discussion document and source of truth for implementing access profiles, identity mapping and the WordPress import mapping. Supersedes the framework draft in [TAXONOMY-AND-ACCESS-MODEL.md](TAXONOMY-AND-ACCESS-MODEL.md) where they differ. Nothing in this document is implemented yet beyond the platform mechanics described in section 2.

Evidence labels: **verified** (read from the WordPress backup, the Auth0 tenant export or Portal code, read-only, 2026-11-18), **decided** (owner decision), **proposed** (recommendation awaiting confirmation), **open**.

## 1. How WordPress controlled access (verified)

### 1.1 Roles

The resource site had **29 WordPress roles** doing five different jobs at once:

| Kind | Roles |
| --- | --- |
| Staff jobs | Administrator, Content Manager (`editor`), Stakeholder (`author`), MRM (`contributor`), Case Design, Beaver Builder Editor |
| Membership tier | Basic (`subscriber`), Full-Active (`full-only`) |
| Business affiliation | AEWM Only, Sub-Advisor (agency model offices), AEI |
| Signature status | Premier, Elite, Legends |
| Firm groups | Four AExchange firm groups |
| Programs and cohorts | Rob Russell Coaching, Rob Russell Bootcamp, Transformation: Taxes, Transformation: Marketing, IUL Masters Academy, AE Wealth Mastermind, Ridgeback: Climbing Together, G2 |
| Account state | Pending account activation, Deactivated |

### 1.2 How files were gated

Each Download Manager package listed roles; a person holding **any** listed role could open it ("any of" semantics). Across the **3,686 active published packages**:

| Rule as configured | Packages | Share |
| --- | --- | --- |
| Full-Active only | 1,624 | 44% |
| Full-Active or Basic (all members) | 862 | 23% |
| AEWM Only | 765 | 21% |
| AEWM or Full-Active | 86 | 2% |
| **Top four combined** | **3,337** | **90.5%** |

The remaining 9.5% are small explicit groups: Rob Russell programs (88), Commission Schedules (48), signature tiers (about 110), AExchange firm groups (about 80), Sub-Advisor (28), Transformation, AEI and a few others.

Other findings:

- **"Any of" hides intent.** "Full-Active or Elite or Legends" in practice means Full-Active; nobody can tell from a package who it is really for.
- **Phantom rules.** 1,127 packages list `io`, `life` or `medicare`, and 10 list `aefs`, but none of these exist as WordPress roles, so they most likely granted nothing. Probably intended as Insurance-only, Life, Medicare and AE Financial Services.
- **`__wpdm__`** appears on most packages: a Download Manager internal marker, not a role.
- **Everything was hand-maintained per user**, with no link to CRM or identity data.
- **Expiry was routine:** 3,813 of 3,827 published packages have an expiry date.
- WordPress categories also describe Business Unit (e.g. AEWM 841 items, Annuity 464, Life 375, Medicare 133), Licensure (IAR-RIA 1,415, Insurance Only 977) and Audience (Advisor-facing 2,895, Consumer-facing 726). These were descriptive, not access controls.

## 2. What the new platform already has (verified)

- **Access profiles** attached to items, each with rules granting **view**, **AI retrieval** (MCP) and **original download** separately.
- **Audiences** and **user memberships** matched against those rules.
- **Fail-closed:** unknown, unmapped or inactive means no access; imported items arrive restricted (Intake, no profile) until someone assigns one.
- Enforcement on every read path: library pages, search, citations, files, MCP.

Missing until this model is implemented: the business vocabulary (which audiences and restrictions exist) and the automatic feed of user attributes.

## 3. Identity sources (verified; payload contents to confirm)

- **Auth0** signs everyone in. A Post-Login Action calls the **AE Access Management (AM) service** per application and adds a gzipped `http://advisorsexcel.com/access` claim with `scopes` (each with `type`, `id`, `roles`, `perms`) and `recordTypes`, plus `http://advisorsexcel.com/contactId`.
- **AE and AEWM employees** sign in through Azure AD; their AD groups pass through Auth0. (**Setup note:** the current Active Directory Action only maps groups to an `access` claim for applications listed in its own mapping, e.g. Trade. The Library needs its own entry, or the groups passed as a claim.)
- **Portal** reads CRM contact data such as head of hierarchy (and whether the person is the head), record type (Advisor/Staff), AEWM advisor status and production, from which it computes signature tiers (Premier from $10M, Elite from $25M, Legends above).

**Decided:** Access Management is the single source. The Library reads everything from the AM payload in the sign-in token and does not call the CRM itself; AM sources CRM data. Basic vs Full-Active is already derived from the person's AM role. The remaining fields are expected in the AM payload; **to confirm** (section 9).

**Decided:** freshness at sign-in or token refresh is acceptable; a change in AM applies from the person's next sign-in.

## 4. The model (decided)

Four sources of access, each with one owner:

| Layer | What | Owner |
| --- | --- | --- |
| A. Facts about the person | Account status, person type, firm, affiliation, signature tier, Basic/Full-Active | Automatic, from the AM payload |
| B. What each item requires | Audience plus optional restrictions | AE editors, choosing named profiles |
| C. Special access granted by AE | Program enrollments, firm groups | Access Steward, in AM |
| D. Access a firm shares with its people | Firm library roles | The firm, in Office Manager (via AM) |

### 4.1 Layer A: facts about each person (automatic)

| Attribute | Values | Notes |
| --- | --- | --- |
| Account status | Active / pending / deactivated | Pending and deactivated see nothing |
| Person type | AE employee, Advisor, Advisor staff | Employees from Azure AD groups |
| Firm | Firm identified by its head of hierarchy | |
| Affiliation | AEWM, Agency office (Sub-Advisor), AEI | |
| Signature tier | Insiders, Premier, Elite, Legends | From production, as Portal computes it |
| Membership | Basic, Full-Active | From the AM role (decided: keep both) |

**Decided:** staff inherit **firm, affiliation and signature tier** from their head of hierarchy. **Licensing is not used** for access; firm affiliation is the business gate.

### 4.2 Layer B: what each item requires (AE editors)

| Setting | Choices |
| --- | --- |
| **Audience** (required) | Employees only · All members (Basic and up) · Full-Active members |
| **Affiliation** (optional) | **AEWM-restricted**: AEWM firms (advisors and their staff) **and AE/AEWM employees** |
| **Signature tier** (optional) | Premier and above · Elite and above · Legends. **Tiers inherit upward** (Legends sees Elite and Premier content) |
| **Firm group** (optional) | One or more firm groups |
| **Program** (optional) | One or more programs |
| **Library section** (already on every item) | Products · Operations · Marketing · Planning · Coaching · Events. Used for firm sharing (4.4) |
| **Actions** | View, AI retrieval and download each on or off. **Default: all on** |

Editors pick **named access profiles** (e.g. "All members", "Full-Active", "AEWM-restricted", "Elite and above") rather than building rules; only the Access Steward creates or widens profiles. Publication and expiry dates still apply, and expiry from WordPress is kept.

**Decided:** commission schedules and rate tables in scope are **general baseline** material, available to **all members**, including AI retrieval. Firm-specific commission material is **out of scope** and handled elsewhere. There is no separate sensitive-content entitlement for now.

### 4.3 Layer C: special access granted by AE

- **Program enrollments**, each with optional start and end dates. Each program is set to one of:

  | Program sharing | Who sees program content |
  | --- | --- |
  | **Personal** (default) | Only the people enrolled |
  | **Firm-shareable** | The enrolled advisor, plus firm staff whose library role covers the content's section |

  **Decided:** both are supported; programs are personal unless deliberately marked shareable.
- **Firm groups** (successors of the AExchange roles): firms are assigned to groups, and staff then follow their firm library role.

### 4.4 Layer D: firm sharing in Office Manager (decided)

Advisors and office managers will assign library access to their own people in Office Manager. The rule advisors need to understand:

> **A firm can share its access with its people, but never more than the firm itself has.**

An AEWM firm can give a staff member AEWM content; a non-AEWM firm cannot. An Elite firm can share Elite content; a Premier firm cannot grant Elite.

| Library role | What the person sees |
| --- | --- |
| **Full library access** | Everything the firm can see |
| **Library access by area** | The firm's content, limited to chosen sections (e.g. Marketing and Operations) |
| **No library access** | Nothing |
| **Manage library access** (add-on) | Can assign these roles to others in the firm |

**Decided:** start with these three roles plus the add-on; firms grant **areas**, not individual documents. Restrictions (AEWM, tier, firm group, program) always apply on top, so a role never reaches past what the firm qualifies for.

In Office Manager the firm's access is shown plainly, for example: "**Shared with your team:** AEWM content, Elite content, Rob Russell Bootcamp" and "**Just for you:** Rob Russell Coaching".

### 4.5 The access rule

A person sees an item when:

1. their account is active; **and**
2. they meet the item's **audience**; **and**
3. they meet **every** restriction on the item (within one restriction, any listed value works, e.g. firm group A or B); **and**
4. for **advisor staff**: their firm qualifies **and** their firm library role covers the item's section (personal programs require their own enrollment); **and**
5. the item is published and inside its available/expiry dates.

AE and AEWM employees see AEWM-restricted items; AE staff with the relevant team role can see restricted items for support. View, AI retrieval and download are checked separately for each request.

### 4.6 Worked example

A non-AEWM, Elite firm; its marketing assistant has "Library access by area: Marketing".

| Item | Sees it? | Why |
| --- | --- | --- |
| Full-Active marketing campaign kit | Yes | Firm is Full-Active; Marketing is in the role |
| Elite-and-above seminar toolkit, filed under Marketing | Yes | Firm is Elite; Marketing is in the role |
| AEWM-restricted investment guide | No | Firm is not AEWM |
| Operations checklist | No | Operations is not in the role |

## 5. AE roles (decided)

WordPress staff roles (Administrator, Content Manager, Stakeholder, MRM, Case Design, Beaver Builder Editor) are **not audiences**. They become platform jobs: editor, reviewer, publisher and administrator, plus a new governance role:

**Access Steward**: governance of access, below full administration. Can create and update programs (including personal or shareable), create firm groups and assign firms, create and adjust the named access profiles, approve anything that widens access, and see the audit of access changes. Cannot manage AE staff accounts or system settings, and cannot edit or publish content.

## 6. WordPress to new model mapping

| WordPress | New model |
| --- | --- |
| Basic + Full-Active | Audience: All members |
| Full-Active only | Audience: Full-Active members |
| AEWM Only | Affiliation: AEWM-restricted |
| AEWM or Full-Active (86 items) | **Open:** decide per item; default restricted until decided |
| Premier / Elite / Legends | Minimum signature tier (inherits upward) |
| AExchange firm groups | Firm group |
| Rob Russell, Transformation, IUL Masters, Mastermind, Ridgeback, G2, AEI | Program (personal unless marked shareable) |
| Sub-Advisor (agency offices) | Affiliation: agency office (or retire if not needed) |
| Commission Schedules | Audience: All members (baseline material only) |
| `io`, `life`, `medicare`, `aefs` | Dropped (licensing not used) |
| `__wpdm__` | Ignored (Download Manager marker) |
| guest | Retire, unless a use is found |
| Pending / Deactivated | Account status: no access |
| Administrator, Content Manager, Stakeholder, MRM, Case Design, Beaver Builder Editor | AE platform jobs (section 5), not audiences |
| Events (`tribe_events`) | Not migrated; events live in AE Portal |

Result: **29 roles become 3 audiences, 4 restriction types, 3 firm library roles plus one add-on, and AE jobs kept separate.**

## 7. Decision log (2026-11-18)

1. Keep Basic vs Full-Active as two audiences; determined in Access Management from the person's role.
2. AEWM-restricted content is readable by AEWM firms and AE/AEWM employees.
3. Signature tiers inherit upward.
4. Firms will manage their people's library access in Office Manager; the model must be clear to advisors. Start with three library roles plus a manage add-on, granted by section.
5. Licensing does not gate access; firm affiliation does.
6. Programs, firm groups and firm library roles live in Access Management.
7. Baseline commission schedules and rate tables are open to all members, including AI retrieval; firm-specific material is out of scope.
8. Programs can be personal or firm-shareable; personal by default.
9. A new **Access Steward** role governs granular access below full administration.
10. Access Management is the single identity source for the Library; CRM data reaches the Library only through the AM payload. Sign-in freshness is acceptable.
11. Azure AD groups pass through Auth0 and identify AE/AEWM employees.
12. Events are not migrated.

## 8. Implementation notes (for later; not started)

- Register the Library as an application in Access Management and Auth0; add a Library entry to the Active Directory Action (or pass groups as a claim).
- Read the AM `access` claim at sign-in; map its fields onto the platform's memberships; keep fail-closed behaviour for anything missing.
- Create the named access profiles in section 4.2 and the Access Steward role with its permissions.
- Implement firm sharing (section 4.4): firm qualification plus section-limited roles; personal vs shareable programs.
- WordPress import: map each package's roles through section 6 into a profile on the item. **Implemented 2026-11-19** (`profileForWordPressRoles` in `apps/platform/src/domain/access-seed.ts`): the migration autopilot sets the mapped profile on the Draft; packages with no gating roles get **No WordPress roles (hidden)**, a profile with no rules that nobody can read until rules are added; ambiguous or mixed packages get none and wait under "Needs an audience". Per the owner's 2026-11-19 decision, an administrator confirms in bulk on **Approve drafts** rather than item by item. Nothing is published automatically.
- The named access profiles and audiences are seeded by the worker (create-only). Still to do: the Access Steward role, AM claims and firm sharing.
- Tests: two firms, AEWM vs non-AEWM, each tier, staff with each library role, personal vs shareable program, pending/deactivated, employee access to AEWM items, and view vs AI retrieval vs download on every path (pages, search, citations, files, MCP).

## 9. Open items

1. **AM payload fields to confirm:** account status, person type, firm (head of hierarchy), affiliation, signature tier, program enrollments with sharing setting, firm groups and firm library roles (section 3).
2. **The 86 "AEWM or Full-Active" items:** decide per item during migration review.
3. **Sub-Advisor / agency office:** keep as an affiliation or retire.
4. **guest role:** confirm it can be retired.
