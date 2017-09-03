import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import http from 'http';
import { invert, isArray } from 'lodash';
import url from 'url';
import cookieParser from 'cookie-parser';
// eslint-disable-next-line import/no-unresolved, import/no-extraneous-dependencies, import/extensions
import queryMap from 'persisted_queries.json';

import websiteMiddleware from './middleware/website';
import graphiqlMiddleware from './middleware/graphiql';
import graphqlMiddleware from './middleware/graphql';
import tokenMiddleware from './middleware/token';
import addGraphQLSubscriptions from './api/subscriptions';
import settings from '../../settings';
import log from '../common/log';

const SECRET = 'secret, change for production';

// eslint-disable-next-line import/no-mutable-exports
let server;

const app = express();

app.use(cookieParser());

const { port, pathname, hostname } = url.parse(__BACKEND_URL__);
const serverPort = process.env.PORT || port;

// Don't rate limit heroku
app.enable('trust proxy');

if (__DEV__) {
  const whitelist = [`http://localhost:${settings.webpackDevPort}`, `http://${hostname}:${settings.webpackDevPort}`];

  let corsOptions = {
    origin: whitelist,
    credentials: true
  };
  app.use(cors(corsOptions));
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use('/', express.static(path.join(settings.frontendBuildDir, 'web'), { maxAge: '180 days' }));

if (__DEV__ && settings.webpackDll) {
  app.use('/', express.static(settings.dllBuildDir, { maxAge: '180 days' }));
}

if (__PERSIST_GQL__) {
  const invertedMap = invert(queryMap);

  app.use(
    '/graphql',
    (req, resp, next) => {
      if (isArray(req.body)) {
        req.body = req.body.map(body => {
          return {
            query: invertedMap[body.id],
            ...body
          };
        });
        next();
      } else {
        if (!__DEV__ || (req.get('Referer') || '').indexOf('/graphiql') < 0) {
          resp.status(500).send("Unknown GraphQL query has been received, rejecting...");
        } else {
          next();
        }
      }
    },
  );
}
app.use((...args) => tokenMiddleware(SECRET)(...args));
app.use(pathname, (...args) => graphqlMiddleware(SECRET)(...args));
app.use('/graphiql', (...args) => graphiqlMiddleware(...args));
app.use((...args) => websiteMiddleware(queryMap)(...args));

server = http.createServer(app);

addGraphQLSubscriptions(server, SECRET);

server.listen(serverPort, () => {
  log.info(`API is now running on port ${serverPort}`);
});

server.on('close', () => {
  server = undefined;
});

if (module.hot) {
  module.hot.dispose(() => {
    try {
      if (server) {
        server.close();
      }
    } catch (error) {
      log(error.stack);
    }
  });
  module.hot.accept(['./middleware/website', './middleware/graphql']);
  module.hot.accept(['./api/subscriptions'], () => {
    try {
      addGraphQLSubscriptions(server, SECRET);
    } catch (error) {
      log(error.stack);
    }
  });

  module.hot.accept();
}

export default server;