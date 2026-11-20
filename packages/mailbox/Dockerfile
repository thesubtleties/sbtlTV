FROM node:24-alpine
WORKDIR /app
COPY dist/main.js ./main.js
USER node
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
# Totals for Prometheus only (METRICS_PORT); never published through the Service/Ingress
EXPOSE 9464
CMD ["node", "main.js"]
