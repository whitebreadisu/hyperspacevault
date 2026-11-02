# ADR-0038: Backend image scanning runs in CI, not in Artifact Registry

## Status
Accepted — 2026-11-02 (owner, October bill review, session 2026-11-02: option 2, "turn off Artifact Registry scanning and scan in GitHub Actions", approved; the fail rule, the daily cadence and the hand-disable-plus-guard mechanism below are the build's recommendation after review). Replaces the RR-11 control (Artifact Registry vulnerability scanning, enabled 2026-07-08), which had no ADR; its text is archived under "Archived 2026-11-02 — image scanning moves to CI (BL-327)" in `specification_documents/SWU_Platform_Spec_Archive.md`. Implements BL-327.

## Context
RR-11 enabled `containerscanning.googleapis.com` in both projects. Artifact Analysis then scanned every image pushed to Artifact Registry and re-checked it as new CVEs were published, with results in the registry console.

The October 2026 bill was $90.36, over the $50 budget (Platform Spec §4.6). $47.84 of it was the "Container Registry Vulnerability Scanning" SKU, up about 4,500% on the month. The charge is per pushed image, and each code merge to main pushes the same image to two registries (`swu-prod` and `swu-dev-jbapps`, Platform Spec §2.4), so the cost rises with merge count. The coming card-pages and v3.0 work means more merges.

The repository is public, so GitHub Actions minutes and GitHub code scanning are free, and code scanning is already on (CodeQL default setup).

## Decision
**1. Turn the paid scanner off in both projects, and keep it off through Terraform.** The API was disabled by hand in both projects on 2026-11-02 (`gcloud services disable`, without `--force`; both calls succeeded, and a repeat call against the already-disabled API exits 0). Doing it by hand started the saving at once and showed the real behaviour before any apply depended on it. `gcloud services disable` without `--force` can refuse an API used in the last 30 days, and a refusal inside the full `terraform apply` would have stopped a deploy half-way.

`google_project_service` cannot declare an API disabled. Taking the resource out of the configuration only removes it from state while its stored `disable_on_destroy` is `false`, because a destroy reads that flag from state, not from config. The other route, flipping the flag to `true` in one merge and deleting the resource in a later one, works only if prod applies both merges in order. The release train can promote several merges at once, so prod could skip the first. So `terraform/modules/app/apis.tf` drops the RR-11 resource and adds a `terraform_data` resource as a **guard**. On its first apply in each project, a `local-exec` provisioner reads whether `containerscanning.googleapis.com` is enabled and tries to disable it only if it is. It never fails the apply: an unreadable state or a refused disable prints a WARNING and exits 0, and `on_failure = continue` covers anything else. Without `--force`, no dependent service is ever disabled along with it. The daily prod scan (3) goes red while the API is enabled in prod, so a refusal or a later console re-enable shows up within a day. `containeranalysis.googleapis.com`, the free metadata API the scanner depends on, is left as it is: nothing in this repository uses it and it bills nothing on its own.

**2. Scan every image before it is pushed (`ci.yml` job `image-scan`).** On a main push, before `build-and-push`, the job builds the `runtime` stage into the runner's Docker daemon and runs Trivy (`aquasecurity/trivy-action`, pinned to a full commit SHA). The rule:
- Every HIGH and CRITICAL finding that has a fix is uploaded as SARIF to code scanning (category `trivy-backend-image`). Findings appear in the Security tab next to Dependabot's and close themselves when a later scan no longer finds them.
- A CRITICAL with a fix fails the job. `build-and-push` needs `image-scan`, so nothing is pushed and dev is not deployed.
- HIGH is reported, not blocking. Findings with no fix are not reported, because nothing in this repository can act on them.
- A waiver is a line in the repo-root `.trivyignore`: the vulnerability id, a dated reason and a review-by date. Every Trivy step in both workflows reads the file, so a waived finding neither blocks nor reports. The file holds only its format header today.
- A scan that fails for any other reason also stops the chain, for example when the vulnerability database cannot be fetched. Three database mirrors are tried in order (`TRIVY_DB_REPOSITORY`), and re-running the job is the remedy.

The job holds no GCP credential. The scanner is third-party code, so it never shares a job with the token that can push images or apply Terraform. Without that credential the job cannot fetch the bootstrap catalog export, so its last `COPY` layer lacks one JSON data file. The base and dependency layers, which are what Trivy assesses, are written to the gha cache that `build-and-push` reads, so the pushed image reuses the scanned layers.

**3. Scan the image prod serves, every day (`.github/workflows/image-scan-prod.yml`).** This replaces Artifact Analysis's continuous re-check. The first job authenticates by WIF as `terraform-ci@swu-prod`, the pattern `health-check.yml` already uses, so no new secret or identity is added. It checks that `containerscanning` is still disabled in prod and reads the image Cloud Run serves. It then pulls the image and flattens it with `docker create` and `docker export`. It deletes the catalog export (`app/ingestion/data/*.json` in the image) from the tar and fails closed if any such file remains.

The hand-off carries a filesystem, not the image, for two reasons. The export is private data kept out of this public repository (ADR-0004, 2026-07-29 amendment), and workflow artifacts on a public repository can be downloaded. A second job holds no GCP credential; a job granted `id-token` can mint a token at any step, so the scanner cannot be kept from it inside one job. That job unpacks the filesystem and scans it with Trivy (`scan-type: rootfs`) under the same rule, uploading to code scanning (category `trivy-prod-image`). It then deletes the artifact; `retention-days: 1` is the backstop. The run turns red on a CRITICAL with a fix, or while `containerscanning` is enabled in prod.

Daily keeps the detection gap close to the continuous re-check it replaces. Code-scanning alerts deduplicate, so a daily run opens an alert only for a new finding.

## Consequences
- + The scanning line leaves the bill (about $48 in October). The check is the first full month after the change reaches prod.
- + Scanning moves earlier: a fixable CRITICAL stops the image before any registry or environment sees it. Artifact Analysis only reported after the push.
- + Findings are in the Security tab beside Dependabot's alerts, not in the registry console.
- − A newly published CRITICAL with a fix stops every main deploy until the base image or the dependency is bumped, or a dated waiver is added. That is intended, but it can block an unrelated merge. So can a scan that fails outright (re-run the job).
- − `image-scan` sits in series before `build-and-push`: a second build plus two scans on the deploy path. The added time is measured on the first main run after it lands and recorded in Platform Spec §2.4.
- − The pull job of the daily scan holds `terraform-ci`, which has wide admin roles. Only Google's actions, `gcloud` and `docker` run in that job. A dedicated reader identity with only `artifactregistry.reader` would be narrower; it needs an IAM and WIF change applied by the owner and is not part of this decision.
- − The guard is imperative and depends on `bash` and `gcloud` on the applying machine's PATH (true in both CI apply paths). It runs once per project; if the API is turned back on later, Terraform will not see it. The daily prod check goes red in that case. Dev has no daily check, so the bill (§4.6) is its backstop.
- − PRs are not scanned: the scan runs after merge, on main. A PR-side scan of backend changes is a possible later addition.
