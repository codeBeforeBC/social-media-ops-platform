FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS build
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked rm -f /etc/apt/apt.conf.d/docker-clean && apt-get update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends gcc libc6-dev linux-libc-dev
COPY tools/media/sandbox.c /sandbox.c
RUN gcc -O2 -Wall /sandbox.c -o /media-sandbox
FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked rm -f /etc/apt/apt.conf.d/docker-clean && apt-get update && (apt-get -o Acquire::Retries=3 install -y --no-install-recommends python3 python3-pil poppler-utils fonts-dejavu-core ca-certificates || apt-get -o Acquire::Retries=3 install -y --no-install-recommends python3 python3-pil poppler-utils fonts-dejavu-core ca-certificates) && rm -rf /var/lib/apt/lists/* && mkdir /scratch && chown node:node /scratch
COPY --from=build /media-sandbox /usr/local/bin/media-sandbox
COPY tools/media/server.mjs /app/server.mjs
COPY tools/media/png-preview.py /usr/local/lib/yoyo/png-preview.py
USER node
WORKDIR /app
CMD ["node","server.mjs"]
