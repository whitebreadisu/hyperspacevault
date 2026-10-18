# Platform
## 1. Auth
The `ghost-job` job here is outside section 2.
## 2. CI/CD Pipeline
### 2.1 Overview
```
backend ──┐
frontend ─┴─► ci-ok

promote — independent of the chain above; see below
```
The `backend` job and the `ci-ok` job run first; the `frontend` job too. `promote` is dispatched.
## 3. Terraform
