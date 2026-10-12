# HQ: building the show and a single-file server
#
# We build with whatever command you named yourself (npm run build of the
# HQ directory), and serve the directory from the zaria.hq field. The image
# is the same node by digest as the head's: one base for the whole stack -
# one download and one set of vulnerabilities to watch.

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS build
# the value of the argument is visible to RUN commands of this stage as an
# environment variable - npm substitutes it in .npmrc. ENV is not needed
# here: it would write the secret into the stage metadata
ARG ZORIA_NPM_AUTH=
WORKDIR /app
COPY .npmrc ./
COPY hq/package*.json ./
# the whale's stub does not need dependencies at all, your build does:
# there is a lock - install by it, there is not - build as is
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; fi
COPY hq/. ./
RUN npm run build

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
ENV NODE_ENV=production
ENV HQ_PORT=8080
ENV HQ_ROOT=/app/show
WORKDIR /app
COPY --from=build /app/dist show
COPY hq/serve.mjs serve.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.HQ_PORT + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "serve.mjs"]
