// Hosting from the app always uses SQLite; PostgreSQL is for standalone servers.
export default {
  Pool: class {
    constructor() {
      throw new Error('PostgreSQL is not available when hosting from the River app');
    }
  },
};
