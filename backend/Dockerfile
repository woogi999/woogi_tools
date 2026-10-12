# The download backend (see server.mjs). Built from the repository root, as
# render.yaml asks, because it shares two link-checking files with the site.
FROM node:22-bookworm-slim

# FFmpeg joins a video's picture and sound; Python runs yt-dlp and gallery-dl.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The newest of both every time the image is built: sites change, and an old
# yt-dlp is the usual reason a download stops working. Redeploy to refresh.
RUN python3 -m venv /opt/tools \
  && /opt/tools/bin/pip install --no-cache-dir --upgrade "yt-dlp[default,curl-cffi]" gallery-dl
ENV PATH="/opt/tools/bin:$PATH" \
  NODE_ENV=production

WORKDIR /srv
# Laid out as in the repository, so server.mjs's imports are the same here.
RUN echo '{"type":"module"}' > package.json
COPY app/utils/video-platforms.js app/utils/bunkr-link.js ./app/utils/
COPY backend/server.mjs backend/bunkr.py ./backend/

USER node
EXPOSE 10000
CMD ["node", "backend/server.mjs"]
