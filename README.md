# Capitan

MDB newbie solo project. Capitan is an iPhone app for climbing gyms: photograph a
wall, and it detects the holds, groups them into routes by color, and plans a
hand/foot sequence up the route you pick, personalized to your height and wingspan.

- **`rc/`** — the Expo / React Native app. Talks to the backend over HTTP (or an in-app mock).
- **`backend/`** — the Python ML pipeline: quality check, hold detection, route
  colors, per-hold depth + graspability, wall geometry, beta planner. See
  [`backend/README.md`](backend/README.md).
- **`PROGRESS.md`** — full build log with results and decisions.

## Quick start

```bash
# Backend
python3 -m venv .venv
./.venv/bin/pip install -r backend/requirements.txt
./.venv/bin/python data.py                              # fetch the dataset (Kaggle)
./.venv/bin/python backend/scripts/plan_beta.py --stem 0075

# App
cd rc && npm install && npx expo start                  # open in Expo Go
```

`data.py` downloads into the kagglehub cache; the scripts expect the images under
`data/{bh,bh-phone,sm}` with the `*-annotation.{csv,json}` files beside them.
