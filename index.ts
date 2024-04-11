import { Context, Env, Hono } from 'hono';
import { todos } from './data.json';
import { Ratelimit } from '@upstash/ratelimit';
import { BlankInput } from 'hono/types';
import { env } from 'hono/adapter';
import { Redis } from '@upstash/redis/cloudflare';

declare module 'hono' {
  interface ContextVariableMap {
    ratelimit: Ratelimit;
  }
}

const app = new Hono();

const cache = new Map();

class RedisRateLimiter {
  static instance: Ratelimit;

  static getInstance(context: Context<Env, '/todos/:id', BlankInput>) {
    if (!this.instance) {
      const { REDIS_URL, REDIS_TOKEN } = env<{ REDIS_URL: string; REDIS_TOKEN: string }>(
        context
      );

      const redisClient = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

      const ratelimit = new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(4, '10 s'), //amount of req per time
        ephemeralCache: cache,
      });

      this.instance = ratelimit;
      return this.instance;
    } else {
      return this.instance;
    }
  }
}

app.use(async (context, next) => {
  const ratelimit = RedisRateLimiter.getInstance(context);
  context.set('ratelimit', ratelimit);
  await next();
});

app.get('/todos/:id', async (context) => {
  const ratelimit = context.get('ratelimit');
  const ip = context.req.raw.headers.get('CF-Connecting-IP');

  const { success } = await ratelimit.limit(ip ?? 'anonymous');

  if (success) {
    const todoId = context.req.param('id');
    const todoIndex = Number(todoId); //1, 2, 3
    const todo = todos[todoIndex] || { title: 'Invalid todo' };

    return context.json(todo);
  } else {
    return context.json({ error: 'Too many requests' }, { status: 429 });
  }
});

export default app;
