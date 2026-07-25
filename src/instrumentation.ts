/**
 * Bootstrap do Next.js.
 *
 * O módulo com dependências Node fica separado para que o bundle Edge não tente
 * resolver `http`, `ws`, Prisma ou os serviços persistentes da aplicação.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeRuntime } = await import('./instrumentation-node');
    await registerNodeRuntime();
  }
}
