# Zoria submission: the participant stack

This stack was added by the command `npx zaria-kit init stack` around what you
already had. It passes the admission gates of part 4 - P4-01 ... P4-04 and
P4-10 ... P4-11 - and after that changes however you like: a queue, a cache,
a database, a second service, your own head. Your code is graded, not
fidelity to the template.

## What was added

| Path | What it is |
|---|---|
| `compose.yaml` | the submission stack: head, service handles, HQ; roles - by labels |
| `bot/Dockerfile` | the head image: `npm ci`, build, run by the command from `zaria.bot` |
| `control-plane/` | the bot's service handles, with no dependency at all |
| `.npmrc` | the contest registry and a reference to `ZORIA_NPM_AUTH`; no secret in the file |
| `.dockerignore`, `.gitignore` | what does not go into the build context and the repository |

The HQ directory (`zaria-kit init hq`) gets its own `Dockerfile` and
`serve.mjs`, and the stack gets the `hq` service with the `zaria.hq` label.
No HQ - no service, and the run's `hq-bundle` stage simply does not run:
this does not stand in the way of matches, but twenty points of the HQ axis
turn to zero at admission. Set up HQ later than the stack - call
`npx zaria-kit init stack --force`, and the service gets added.

## Next

```sh
cd bot && npm install && cd ..   # a lockfile is required (02-build.md, 4.4)
npm install                          # the kit at the root: npx zaria-kit finds it here
npx zaria-kit preflight              # the same eleven stages we run
```

You need Docker with compose v2 and Node.js 24. `preflight` builds the
images, brings up the stack, plays a short trial match and writes a verdict
to `preflight.json`. The registry secret is taken from the `ZORIA_NPM_AUTH`
variable of your environment and does not end up in the image.

HQ is built with its own command - if you have one, `npm install` is also
needed in its directory.

## Roles and labels

The pipeline reads roles by labels, not by names of services:

| Label | Applies to | What it means |
|---|---|---|
| `zaria.role: head` | exactly one service | the head on the wire: the node gives it `ZARIA_URL` and `ZARIA_TOKEN` |
| `zaria.control: <port>` | at most one | service handles; without the label - the head, port 7801 |
| `zaria.hq: <port>` | at most one | HQ: serves the built page |
| `zaria.belief: <path>` | on the head | the absolute path of the belief diary inside the container |

There can be any number of services, even one for every role. The machine's
rules (no `privileged`, no foreign networks or namespaces, no bind mounts,
no `include` and `extends`) - `02-build.md`, section 3.

## The seam of two planes

The head is the data plane: it holds the wire and the tick, and nothing
else. Service handles are the control plane: everything asked from outside.
The head hands them a snapshot over its internal port (`STATUS_PORT`,
the `plane` network, not published outward), and they read the belief
diary from a shared volume.

What the seam is for: the head keeps playing the match through even if the
control plane restarts; `belief-stream` subscribers do not live in the tick
loop; `/health` and `/metrics` cost the head one response on the internal
port. The price - an extra hop and a timeout (`HEAD_TIMEOUT_MS`, 1000 ms):
the head did not answer - 503 with a reason.

You can merge both planes into one process: then state is read from memory
with no hop, but restarting control brings the wire down.

## Bringing it up by hand

The stack comes up under the node: the address and the place seal arrive at
the head as variables.

```sh
ZARIA_URL=ws://... ZARIA_TOKEN=... docker compose up --build
curl -s localhost:7801/health
curl -s localhost:7801/metrics
curl -sN localhost:7801/belief-stream | head -3
```

HQ - `http://localhost:8180/`. Ports change with the `ZARIA_CONTROL_PORT`
and `ZARIA_HQ_PORT` variables, the publish address - `ZARIA_BIND` (default
`127.0.0.1`). Without a node address the head sits idle, and `/health`
honestly answers 503.

A local pack of three matches also plays without the stack, right in the
bot's directory: `npm run play -- --fast`.

## Variables

| Service | Variable | Default | What it means |
|---|---|---|---|
| head | `ZARIA_URL`, `ZARIA_TOKEN` | empty | the node address and the place seal; the run sets them |
| head | `ZARIA_ENGINE` | empty | the engine hash the head requires from the node |
| head | `ZARIA_PRESET` | empty | the head style; empty - the bot's own battle style (`полудень`, DEFAULT_PRESET) |
| head | `ZARIA_FREEZE` | empty | `1` - the submission is frozen, promote refuses |
| head | `ZARIA_BELIEF` | `/data/belief.ndjson` | the belief diary; the same path as in the `zaria.belief` label |
| head | `STATUS_PORT`, `STATUS_HOST` | 7811, `0.0.0.0` | the internal state port |
| handles | `PORT`, `HOST` | 7801, `0.0.0.0` | the service contract; must listen on every interface |
| handles | `HEAD_URL`, `HEAD_TIMEOUT_MS` | `http://head:7811`, 1000 | where the head is and how long to wait for it |
| handles | `ZARIA_BELIEF`, `TAIL_MS` | `/data/belief.ndjson`, 100 | whose tail to serve and how often to poll |
| HQ | `HQ_PORT`, `HQ_HOST`, `HQ_ROOT` | 8080, `0.0.0.0`, `/app/show` | the built show's server |

There should be no secrets in the repository at all: everything the build
and the match need arrives as environment variables (`02-build.md`, 6.5).
