import 'dotenv/config';
import { scrapeAll } from '../src/scraping/index';

(async () => {
  const result = await scrapeAll();
  console.log('RESULT:', JSON.stringify(result, null, 2));
  if (!result.success) {
    console.error('COLETA INCOMPLETA:', result.error || 'o lote diário não foi publicado');
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERRO:', e);
  process.exit(1);
});
