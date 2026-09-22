FROM node:22-bookworm-slim
WORKDIR /opt/phosphor
COPY . .
ENV PHOSPHOR_SERVE=1
ENV PHOSPHOR_STANDALONE=1
EXPOSE 8081
CMD ["node", "boot.js"]
