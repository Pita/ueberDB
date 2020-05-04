exports.databases = {
  dirty:{
    "filename": "/tmp/test.db",
    "speeds":{
      numberOfWrites: 1000,
      write: 0.5,
      read: 0.1,
      findKey: 0.2
    }
  }
  ,
  mysql:{
    "user"    : "ueberdb",
    "host"    : "localhost",
    "password": "ueberdb",
    "database": "ueberdb",
    "charset" : "utf8mb4"
  }
/*
  ,
  postgres:{
    "user"    : "postgres",
    "host"    : "localhost",
    "password": "",
    "database": "ueberdb",
    "charset" : "utf8mb4"
  }
  ,
  mongo:{

  }*/
}
