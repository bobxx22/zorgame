# the head on the wire: the bot directory's image
#
# The build context is the repository root (compose.yaml: context: .), so
# the paths here are from the root. The base image is taken by digest, not
# by tag: a tag moves, a digest does not (02-build.md, 4.5).
#
# The registry secret arrives as a build argument and lives only in the
# install stages: the final stage starts from a clean FROM, and it does not
# end up in the finished image. It is not in the repository at all - there
# is only a reference to the variable in .npmrc (02-build.md, 6.5).

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS deps
# the value of the argument is visible to RUN commands of this stage as an
# environment variable - npm substitutes it in .npmrc. ENV is not needed
# here: it would write the secret into the stage metadata
ARG ZORIA_NPM_AUTH=
WORKDIR /app
# the manifest and the lock in their own layer: dependencies survive source
# edits. By a mask, so that npm reports a missing lock, not the bundler:
# the lockfile is required (02-build.md, 4.4), and its name must be in the
# reason
COPY .npmrc ./
COPY bot/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM deps AS build
# the argument is declared in every stage where it is needed: there is no
# inheritance
ARG ZORIA_NPM_AUTH=
RUN npm ci --no-audit --no-fund
COPY bot/tsconfig.json ./
COPY bot/src src
RUN npm run build

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
ENV NODE_ENV=production
ENV STATUS_PORT=7811
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist dist
# our charter: the fill:own tactic reads it next to dist/ at run time
# (charterText in src/strategy.ts); without it the filler is silently off
COPY bot/nakaz.yaml ./
# the diaries go here; the diaries volume is initialized by this directory
# with its owner, otherwise the head without root would not be able to
# write to it
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 7811
# process liveness, not readiness: the head is alive in the lobby but not
# at the table yet. Readiness is served by control-plane at /health
HEALTHCHECK --interval=10s --timeout=2s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.STATUS_PORT + '/state').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# the start command - the zaria.bot field from the bot directory's
# package.json: the lang stage checks exactly that, and the container must
# run the same thing
CMD ["node", "dist/main.js"]
