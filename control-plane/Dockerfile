# service handles: the control plane image
#
# The stub has no dependencies, so there is no npm in the build either: the
# image is a base by digest plus two files. Dependencies appear - add here
# `COPY control-plane/package*.json ./` and `RUN npm ci --omit=dev`.

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=7801
WORKDIR /app
COPY control-plane/package.json ./
COPY control-plane/src src
USER node
EXPOSE 7801
# process liveness, not the bot's readiness: restarting the container for
# "not at the table yet" is not allowed
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/livez').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.mjs"]
