FROM node:24-alpine
WORKDIR /app
COPY dist/main.js ./main.js
USER node
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "main.js"]
