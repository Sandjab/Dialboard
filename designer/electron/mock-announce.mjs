// Faux annonceur mDNS pour tester la découverte SANS matériel : publie un service « dialboard »
// _http._tcp sur PORT (défaut 8099). À lancer en parallèle du mock device (HOST=0.0.0.0).
import { Bonjour } from 'bonjour-service';

const port = Number(process.env.PORT) || 8099;
const bonjour = new Bonjour();
const svc = bonjour.publish({ name: 'dialboard', type: 'http', port });
svc.on('up', () => console.log(`annonce mDNS « dialboard » _http._tcp port ${port}`));
process.on('SIGINT', () => svc.stop(() => { bonjour.destroy(); process.exit(0); }));
