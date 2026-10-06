import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

/** Settings shared by the real server and the test suite, so tests exercise what production runs. */
export function configureApp(app: INestApplication) {
  // Behind a tunnel or proxy every request looks like it comes from the proxy, which would put all users in one rate-limit
  // bucket. TRUST_PROXY is the number of proxies in front (1 for ngrok). Left unset, forwarded headers are ignored.
  const hops = Number(process.env.TRUST_PROXY);
  if (hops > 0) (app as any).set('trust proxy', hops);
  // 'cross-origin' on purpose: the web app shows uploaded media from this server on another origin, and helmet's default
  // ('same-origin') would make browsers refuse to display those images and videos.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
}
