const require3 = require('require3');
const moment = require3('moment');
const chalk = require3('chalk');

module.exports = app => {
  class Version extends app.Service {

    async databaseInitStartup() {
      // database
      await this.__database();
      // version start
      await this.ctx.performAction({
        method: 'post',
        url: '/a/version/version/start',
      });
    }

    async databaseNameStartup() {
      // database
      await this.__database();
    }

    async __database() {
      // db prefix
      const dbPrefix = `egg-born-test-${app.name}`;
      // dev/debug db
      if (app.meta.isLocal) {
        const mysqlConfig = app.config.mysql.clients.__ebdb;
        if (mysqlConfig.database === 'sys' && !app.mysql.__ebdb_test) {
          let databaseName;
          const mysql = app.mysql.get('__ebdb');
          const dbs = await mysql.query(`show databases like \'${dbPrefix}-%\'`);
          if (dbs.length === 0) {
            databaseName = `${dbPrefix}-${moment().format('YYYYMMDD-HHmmss')}`;
            await mysql.query(`CREATE DATABASE \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
          } else {
            const db = dbs[0];
            databaseName = db[Object.keys(db)[0]];
          }
          // create test mysql
          mysqlConfig.database = databaseName;
          app.mysql.__ebdb_test = app.mysql.createInstance(mysqlConfig);// database ready
          console.log(chalk.cyan(`  database: ${mysqlConfig.database}`));
        }
      }
      // test db
      if (app.meta.isTest && !app.mysql.__ebdb_test) {
        // drop old databases
        const mysql = app.mysql.get('__ebdb');
        const dbs = await mysql.query(`show databases like \'${dbPrefix}-%\'`);
        for (const db of dbs) {
          const name = db[Object.keys(db)[0]];
          await mysql.query(`drop database \`${name}\``);
        }
        // create database
        const databaseName = `${dbPrefix}-${moment().format('YYYYMMDD-HHmmss')}`;
        await mysql.query(`CREATE DATABASE \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
        // create test mysql
        const mysqlConfig = app.config.mysql.clients.__ebdb;
        mysqlConfig.database = databaseName;
        app.mysql.__ebdb_test = app.mysql.createInstance(mysqlConfig);
        // database ready
        console.log(chalk.cyan(`  database: ${mysqlConfig.database}`));
      }
    }

    async check(options) {

      if (!options.scene) {
        // confirm table aVersion exists
        const res = await this.ctx.db.queryOne('show tables like \'aVersion\'');
        if (!res) {
          await this.ctx.db.query(`
          CREATE TABLE aVersion (
            id INT NOT NULL AUTO_INCREMENT,
            module VARCHAR(50) NULL,
            version INT NULL,
            createdAt TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id));
          `);
        }
      }

      // check all modules
      for (const module of this.app.meta.modulesArray) {
        await this.__checkModule(module.info.relativeName, options);
      }

      // check if role dirty for init/test
      if (options.scene === 'init' || options.scene === 'test') {
        await this.ctx.performAction({
          subdomain: options.subdomain || '',
          method: 'post',
          url: 'version/after',
          body: options,
        });
      }

    }

    async after(options) {
      // console.log(this.ctx.meta);
      const dirty = await this.ctx.meta.role.getDirty();
      if (dirty) {
        await this.ctx.meta.role.build();
      }
    }

    // update module
    async updateModule(module, version) {

      // update
      await this.ctx.performAction({
        method: 'post',
        url: `/${module.info.url}/version/update`,
        body: {
          version,
        },
      });

      // insert record
      if (version > 0) {
        await this.ctx.db.insert('aVersion', {
          module: module.info.relativeName,
          version,
        });
      }

    }

    // init module
    async initModule(options, module, version) {

      // init
      const url = `/${module.info.url}/version/init`;
      if (app.meta.router.findByPath(null, url)) {
        await this.ctx.performAction({
          method: 'post',
          url,
          body: options,
        });
      }

      // insert record
      if (version > 0) {
        await this.ctx.db.insert('aVersionInit', {
          subdomain: options.subdomain,
          module: module.info.relativeName,
          version,
        });
      }

    }

    // test module
    async testModule(options) {

      // test
      const url = `/${options.module.info.url}/version/test`;
      if (app.meta.router.findByPath(null, url)) {
        await this.ctx.performAction({
          method: 'post',
          url,
          body: options,
        });
      }

    }

    // update this module
    async update(version) {

      if (version === 1) {
        // do nothing
      }

      if (version === 2) {
        await this.ctx.db.query(`
          CREATE TABLE aVersionInit (
            id INT NOT NULL AUTO_INCREMENT,
            subdomain VARCHAR(50) NULL,
            module VARCHAR(50) NULL,
            version INT NULL,
            createdAt TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id));
          `);
      }

    }

    // check module
    async __checkModule(moduleName, options) {

      // module
      const module = this.__getModule(moduleName);

      // fileVersionNew
      let fileVersionNew = 0;
      if (module.package.eggBornModule && module.package.eggBornModule.fileVersion) {
        fileVersionNew = module.package.eggBornModule.fileVersion;
      }

      if (fileVersionNew && (!options.scene || options.scene === 'init')) {
        // update module or init module

        // -1: always
        if (fileVersionNew === -1) {
          await this.__updateModule(options, module, -1, -1);
        } else {
          // fileVersionOld
          let fileVersionOld = 0; // default
          if (!options.scene) {
            const res = await this.ctx.db.queryOne('select * from aVersion where module=? order by version desc', [ moduleName ]);
            if (res) {
              fileVersionOld = res.version;
            }
          } else {
            const res = await this.ctx.db.queryOne('select * from aVersionInit where subdomain=? and module=? order by version desc', [ options.subdomain, moduleName ]);
            if (res) {
              fileVersionOld = res.version;
            }
          }

          // check if need update
          if (fileVersionOld > fileVersionNew) {
            this.ctx.throw(1001, moduleName);
          } else if (fileVersionOld < fileVersionNew) {
            await this.__updateModule(options, module, fileVersionOld, fileVersionNew);
          }
        }

      }

      if (options.scene === 'test') {
        // test module
        await this.__testModule(module, fileVersionNew, options);
      }

    }

    async __updateModule2(options, module, version) {
      // perform action
      try {
        if (!options.scene) {
          await this.ctx.performAction({
            method: 'post',
            url: 'version/updateModule',
            body: {
              module,
              version,
            },
          });
        } else {
          options.module = module;
          options.version = version;
          await this.ctx.performAction({
            method: 'post',
            url: 'version/initModule',
            body: options,
          });
        }
      } catch (err) {
        throw err;
      }
    }

    // update module or init module
    async __updateModule(options, module, fileVersionOld, fileVersionNew) {

      if (fileVersionNew === -1) {
        // always
        await this.__updateModule2(options, module, -1);
      } else {
        // versions
        const versions = [];
        for (let version = fileVersionOld + 1; version <= fileVersionNew; version++) {
          versions.push(version);
        }

        // loop
        for (const version of versions) {
          await this.__updateModule2(options, module, version);
        }
      }

      // log
      options.result[module.info.relativeName] = { fileVersionOld, fileVersionNew };

    }

    // test module
    async __testModule(module, fileVersionNew, options) {
      options.module = module;
      options.version = fileVersionNew;

      await this.ctx.performAction({
        method: 'post',
        url: 'version/testModule',
        body: options,
      });
    }

    // get module
    __getModule(moduleName) {
      return this.app.meta.modules[moduleName];
    }

  }

  return Version;
};
