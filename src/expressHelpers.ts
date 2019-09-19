import * as express from 'express';
import { Logger } from './models';
import { isSerializable } from './misc';

export function registerFunctionsWithExpress(p: {
  fns: any;
  expressApp: express.Application;
  fnAuthKey: string; // Endpoints are only registered if they have a auth function attached.  This a) Allows different auth for different envs (admin vs web-client), b) prevents us from exposing an endpoint accidently
  apiPrefix: string;
  logger?: Logger;
}) {
  let fnNames = Object.keys(p.fns);

  for (let i = 0; i < fnNames.length; i++) {
    let fnName = fnNames[i];
    let refinedApiPath = p.apiPrefix
      .split('/')
      .filter((n) => n.length > 0)
      .join('/');
    let apiPath = `/${refinedApiPath}/${fnName}`;

    let hasAuthFn = typeof p.fns[fnName][p.fnAuthKey] === 'function';

    if (hasAuthFn) {
      console.info(`Registering api path: ${apiPath}`);
    }

    p.expressApp.post(apiPath, async (req: express.Request, res: express.Response) => {
      try {
        if (p.logger) {
          p.logger({ fnName: fnName, details: { body: req.body } });
        }

        if (!hasAuthFn) {
          return res
            .status(401)
            .json({ status: 'unauthorized', details: 'No auth defined for this function. AuthKey: ' + p.fnAuthKey });
        }
        await p.fns[fnName][p.fnAuthKey](req);

        let r1 = await p.fns[fnName](req.body);
        if (!isSerializable(r1)) {
          return res
            .status(500)
            .json({ status: 'Error: Return data cannot be passed over the wire. Must be a plain javascript object.' });
        }
        res.json(r1);
      } catch (e) {
        if (e.statusCode && typeof e.statusCode === 'number' && e.error && e.error instanceof Error) {
          return res.status(e.statusCode).json({ status: 'Error' });
        } else {
          console.error(e);
          return res.status(500).json({ error: 'Error' });
        }
      }
    });
  }
}
