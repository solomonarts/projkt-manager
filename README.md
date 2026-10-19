# VAI Project Manager

A Next.js and Supabase foundation for project delivery, reporting, monitoring, evaluation, and learning.

## Run locally

1. Install a current Node.js LTS release.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable (or legacy anon) key.
4. Apply all SQL migrations in `supabase/migrations` to the Supabase project (Supabase CLI: `supabase db push`, after linking a project).
5. Start the app with `npm run dev`.

The overview loads authenticated dashboard data through a server API route, where Supabase RLS limits projects, tasks, reports and metrics to the current user. Navigation reflects server-resolved permissions. Project progress summarizes available task completion values; records without task data show no progress. The Accounting & Reporting workspace remains a separate workspace and appears in navigation only for users with accounting access. Never put a Supabase service-role key in a browser environment.

## Authentication and member provisioning

The `/login` page uses Supabase password authentication. Middleware refreshes the Supabase session and redirects unauthenticated page requests to sign in; API routes continue to return their own authentication responses. The `/auth/callback` route exchanges invitation codes for a session. A database trigger creates or syncs `profiles` rows from `auth.users`, but never assigns roles. Authenticated members can only edit their own display name and job title; administrative profile fields remain protected by RLS and a database trigger.

Apply `202610140007_auth_users_task_report_rls.sql` after the existing migrations. Deploy the `invite-user` Supabase Edge Function with JWT verification enabled. Configure the function's built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets; optionally set `APP_ORIGIN` and set `INVITE_REDIRECT_URL` to `/auth/callback?next=/update-password`. The invitation function also creates a unique employee ID and returns it to the administrator. The service-role key is used only inside the Edge Function. The caller needs `users.create`; assigning an initial role also requires `users.assign_roles`, and assigning a role with administrative permissions requires `system.manage`. The database independently enforces this role boundary.

Migration `202610140009_employee_registration_ids.sql` adds private employee ID records. Migrations `202610180001_open_registration_approvals.sql` and `202610180002_optional_registration_team.sql` add open applications, optional team assignment, and two-stage team lead/project manager review; apply them after the employee ID and profile ID migrations. Deploy `supabase/functions/employee-auth` with JWT verification disabled because it serves public applications and password recovery as well as authenticated review actions. Registration creates an unconfirmed Auth user and a pending application without an employee ID or application role. Applicants may choose an available team or leave it blank. Authorized team leaders/project managers assign a team and project from the approval inbox; then the team lead and project manager approve. The Edge Function creates the ID, assigns the General Staff Member role and team/project, confirms the Auth email and emails the ID after both approvals.

Configure the Edge Function's built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets, plus `APP_ORIGIN`, `PASSWORD_RESET_REDIRECT_URL` (`https://your-app.example/update-password`), `RESEND_API_KEY`, and `EMPLOYEE_ID_EMAIL_FROM` (a verified Resend sender, for example `VAI Project Manager <accounts@example.org>`). Add the password-reset URL to Supabase Auth's allowed redirect URLs, set the Auth Site URL to the app's real origin, and configure the recovery email template to use `{{ .ConfirmationURL }}`. Public email signup in Supabase Auth can remain disabled because account creation is performed server-side by the Edge Function. The service-role key remains inside the Edge Function.

Team leads see applications for their teams; project managers see applications for their projects. They can only approve their own stage. The Registration approvals navigation item appears when there is a request in their scope. Failed employee-ID email requests remain pending for retry from that workspace. A successful Resend response confirms provider acceptance, not inbox delivery. The separate administrator invitation and ID issuance tools remain available for controlled provisioning.

For existing accounts, a system administrator can use the email sign-in option once to access Administration and issue employee IDs. IDs for existing accounts are linked immediately; new IDs are single-use for account creation. Once the administrator has issued IDs, employees use those IDs for all sign-ins. Keep the administrator email option limited to trusted system administrators; the function rejects email sign-in for other roles.

The same migration replaces overlapping task and report RLS policies, constrains task assignee/reviewer updates, and limits report reviews to the authorized project or team. Apply it before using the invitation and reporting workflows. Edge Function delivery still requires deployment and Auth email/redirect configuration in the Supabase project.

## Authorization model

Permissions resolve in PostgreSQL from configurable role permissions, explicit user grants or revocations, scoped department/team/project/record grants, and membership. `has_permission`, `has_scoped_permission`, `has_team_access`, and `can_access_project` are shared security-definer functions used by RLS policies. Policies are enabled on protected tables and default to no access when no policy matches. Administrative and workflow changes are audited.

Starter roles and granular permission keys are seeded by the migration; administrators can add roles and permissions in the database. Create the first administrator through a trusted server-side provisioning process after a user signs up, then assign the Overall Administrator role (or preserve an existing Super Administrator assignment during migration). Do not allow a public signup flow to grant privileged roles.

## Current scope

The application includes a live RLS-scoped executive dashboard; project, task, team, report, MEAL, risk, and administration workspaces; and an independent Accounting & Reporting workspace with chart-of-accounts, fiscal periods, double-entry journals, approval, and financial report entry points. Tasks support assignment, checklists, dependencies, progress history, private evidence uploads, and review. Reports support drafts, returned report editing, team/project review, source-linked consolidation, private attachments, CSV export, and print-to-PDF. The MEAL workspace tracks indicators and measurements, schedules and reports evaluations, manages reusable form responses, feedback privacy, recommendations, corrective actions, and a likelihood/impact risk register. Shared documents use private storage, RLS-authorized signed downloads, classifications, and version history. In-app notifications are generated for task assignments and report review/return events. The administration workspace edits roles, member assignments, individual overrides, scoped grants, and approval limits; access changes are written to the audit log. Apply every migration in order before using these workflows. Configure at least two active chart accounts and an open accounting period before recording journals. The dashboard only summarizes records currently visible under Supabase RLS.

## Team workplans and scheduled reporting

Migration `202610140008_team_workplans_schedules.sql` adds a primary project for each team, versioned team-specific workplan templates, member workplans and activities, dual team-lead/project-manager approvals, reporting-schedule change approvals, and MEAL team contributions. Approved workplan activities become assigned tasks and create a team reporting schedule. The private `team-workplans` storage bucket accepts PDF templates and member uploads; PDFs are served through short-lived signed URLs.

Deploy `supabase/functions/team-workflows` with JWT verification enabled. The app invokes it for workplan submission/review, schedule-change requests/review, and MEAL team assignment/contribution/review. It uses the caller's JWT and anon key, so RLS and database workflow triggers remain authoritative; it does not use a service-role key.

Deploy `supabase/functions/task-workflows` and `supabase/functions/report-workflows` with JWT verification enabled. The task function handles task creation, progress, review, comments, evidence metadata, checklists, and assignment changes. The report function handles draft creation/updates, submission, review, and team/project compilation. Both use the authenticated caller's JWT and anon key, and rely on permission RPCs plus RLS; neither needs a service-role secret. Report and task file bytes continue to use authenticated Storage policies from the app.

Also deploy `supabase/functions/process-reporting-schedules` and set a strong `REPORTING_CRON_SECRET` function secret. Invoke it with an HTTPS POST and the `x-reporting-cron-secret` header from a trusted scheduler. This scheduled processor uses the server-side service-role key to create due, unverified collective reports and advance schedules. Deployment does not configure a schedule automatically. These workflows are available only after the migration is applied and both functions are deployed/configured.
# projkt-manager
