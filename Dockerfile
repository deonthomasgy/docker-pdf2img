# Copyright (c) 2025 Joan Fabrégat. MIT; see LICENSE.
ARG NODE_IMAGE=node:24.22.1-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE} AS pdf2img-prod
RUN apk upgrade --no-cache && apk add --no-cache \
    imagemagick imagemagick-pdf imagemagick-jpeg imagemagick-webp imagemagick-tiff poppler-utils \
    ttf-liberation ttf-dejavu fontconfig font-noto font-noto-cjk font-noto-emoji \
    ttf-opensans font-awesome font-terminus font-inconsolata \
    && rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/include/node
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json main.mjs ./
COPY policy.xml /etc/ImageMagick-7/policy.xml
ARG VERSION=20261025-node24-r1
ARG BUILD_ID=local
ARG COMMIT_SHA=unknown
ENV NODE_ENV=production PORT=3000 VERSION=${VERSION} BUILD_ID=${BUILD_ID} COMMIT_SHA=${COMMIT_SHA}
LABEL org.opencontainers.image.source=https://github.com/deonthomasgy/docker-pdf2img \
      org.opencontainers.image.version=${VERSION} org.opencontainers.image.revision=${COMMIT_SHA}
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "main.mjs"]
