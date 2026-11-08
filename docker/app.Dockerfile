# Image aplikasi (dipakai bareng oleh service `chain`, `deploy`, dan `collector`):
# berisi kode repo + dependensi Node (ethers, merkletreejs, mongoose, hardhat).
FROM node:20-bookworm-slim

WORKDIR /repo

# .dockerignore root sudah menutup node_modules/artifacts/cache
COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ENV NODE_ENV=development
CMD ["node", "-e", "console.log('siem app image: pilih service chain/deploy/collector')"]
