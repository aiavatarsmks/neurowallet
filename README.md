# NeuroWallet Sprint 0

This repository contains the minimal skeleton for the **Wallet Overview** MVP in the NeuroWallet project. It is organized as a monorepo with separate **frontend** and **backend** packages, a PostgreSQL database provisioned via Docker, and basic test and CI scaffolding.

## Architecture overview

The NeuroWallet MVP is split into two main services:

* **Frontend** (`frontend/`): A [Next.js](https://nextjs.org/) application styled with **Tailwind CSS**. The wallet overview page is exposed at `/wallet` and renders three placeholder components—`BalanceCard`, `TransferButton`, and `TxHistory`. These components are implemented with plain React and Tailwind classes and are ready to be replaced with real UI from the `shadcn/ui` library and web3 integrations using **Ethers.js** and **WalletConnect v2**.

* **Backend** (`backend/`): A small [Fastify](https://fastify.dev/) server written in TypeScript. It exposes a single endpoint at `/api/tx/mock` that returns a list of fake transactions in JSON form. Prisma is configured with a minimal `schema.prisma` file pointing at a PostgreSQL database. Although the current implementation does not persist data, Prisma and the database are ready for future development.

Both services are independent Node.js projects. The repository also includes a `docker-compose.yml` file that provisions PostgreSQL and pgAdmin containers for local development.

## Getting started

### Prerequisites

* [Node.js](https://nodejs.org/) 18 or later
* [Docker](https://www.docker.com/) and Docker Compose

### 1. Clone the repository

```
git clone <your fork url>
cd neurowallet
```

### 2. Start the database

The app uses PostgreSQL to persist data (future development). Start the database and pgAdmin using Docker Compose:

```
docker-compose up -d
```

This will expose PostgreSQL on `localhost:5432` and pgAdmin on `localhost:5050` (login credentials are set in the compose file).

### 3. Configure the backend

Install dependencies and set up environment variables:

```
cd backend
npm install
cp .env.example .env
# (optional) edit .env to match your database credentials

# If you plan to use Prisma migrations later:
npx prisma generate
```

To run the backend server in development mode (listens on port 3001 by default):

```
npm run dev
```

You can verify the mock endpoint by visiting `http://localhost:3001/api/tx/mock` in your browser.

### 4. Configure the frontend

Install dependencies and start the Next.js dev server:

```
cd ../frontend
npm install
npm run dev
```

The wallet overview page will be available at `http://localhost:3000/wallet`. It will make a request to the backend running on port 3001 to fetch mock transactions.

### 5. Running tests

Both the frontend and backend packages include simple unit tests. From the repository root, run:

```
npm test
```

This will execute Vitest suites in both packages. You can also run tests individually by navigating to each package and executing `npm test`.

### 6. Continuous integration

The repository includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that performs linting and runs the unit tests on every push. Linting currently uses placeholder commands; you can replace them with ESLint or your tool of choice.

## Future work

Sprint 0 provides a basic scaffold. Future iterations should implement the actual wallet functionalities:

* Replace placeholder components with interactive UI using **shadcn/ui**.
* Integrate **WalletConnect v2** and **Ethers.js** to connect to Ethereum wallets and perform on-chain actions.
* Define Prisma models and implement real transaction persistence.
* Add authentication, error handling, and input validation.
* Extend tests to cover business logic and UI interactions.

Happy hacking!