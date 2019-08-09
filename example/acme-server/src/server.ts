import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as functions from 'acme-functions';
import { registerFunctionsWithExpress } from 'react-bifrost';

async function main() {
  const app = createServer();

  app.get('/hello', (req, res) => {
    res.json({ hello: 'world' });
  });

  let port = 8080;
  app.listen(port, () => console.log(`App listening on port ${port}!`));
}

function createServer(): express.Express {
  const app: express.Express = express();
  const whiteList = ['https://example.com'];

  const corsOptions = {
    origin: function(origin, callback) {
      if (whiteList.indexOf(origin) !== -1 || origin === undefined || origin.match(/localhost:../)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  };

  app.use(cors(corsOptions));
  app.use(bodyParser.json());

  registerFunctionsWithExpress({
    fns: functions,
    apiPrefix: '/api-functions',
    expressApp: app,
    fnAuthKey: 'exampleAuthFn',
    logger: (p) => {
      console.log('Logger running...');
      console.log(p.fnName);
    }
  });

  return app;
}

main();
