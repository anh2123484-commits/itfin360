import { describe, expect, it } from 'vitest';

import { auditFailures } from '../security/audit.mjs';
import { disallowedLicenses } from '../security/licenses.mjs';
import { findSecrets } from '../security/secret-scan.mjs';

describe('gate de secretos', () => {
  it('detecta un token de GitHub en el diff', () => {
    const hallazgos = findSecrets([
      { file: 'apps/web/src/lib/config.ts', content: `const t = 'ghp_${'a'.repeat(36)}';` },
    ]);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toMatchObject({ file: 'apps/web/src/lib/config.ts', line: 1 });
    expect(hallazgos[0].name).toContain('GitHub');
  });

  it('nunca vuelca el secreto completo en el informe', () => {
    const secreto = `AKIA${'B'.repeat(16)}`;
    const [hallazgo] = findSecrets([{ file: '.env', content: secreto }]);

    expect(hallazgo.preview).not.toContain(secreto);
  });

  it('detecta una URL con credenciales reales y una clave privada', () => {
    const contenido = [
      'DATABASE_URL=postgresql://itfin360:Xk8vQ2mPz@db.produccion.acme.io:5432/itfin360',
      '-----BEGIN RSA PRIVATE KEY-----',
    ].join('\n');

    expect(findSecrets([{ file: 'deploy/.env.prod', content: contenido }])).toHaveLength(2);
  });

  it('no marca las cadenas de conexión de desarrollo', () => {
    const contenido = [
      'DATABASE_URL=postgresql://itfin360:itfin360@localhost:5432/itfin360?schema=public',
      'REDIS_URL=redis://cache:6379',
      'S3_ENDPOINT=http://minio:9000',
    ].join('\n');

    expect(findSecrets([{ file: '.env.example', content: contenido }])).toEqual([]);
  });

  it('no marca una URL interpolada ni un marcador de contraseña', () => {
    const contenido = [
      'const url = `postgresql://${role}:${password}@${host}:${port}/db`;',
      'git clone https://x-access-token:${GITHUB_TOKEN}@github.com/org/repo.git',
      '// SMTP para el magic link (`smtp://user:pass@host:587`).',
    ].join('\n');

    expect(findSecrets([{ file: 'apps/web/src/lib/env.ts', content: contenido }])).toEqual([]);
  });

  it('respeta la exención en línea con motivo', () => {
    const contenido = `const ejemplo = 'ghp_${'a'.repeat(36)}'; // allow-secret: token ficticio de la documentación`;

    expect(findSecrets([{ file: 'docs/ejemplo.md', content: contenido }])).toEqual([]);
  });

  it('acepta un fichero sin credenciales', () => {
    expect(
      findSecrets([
        { file: 'README.md', content: '# ITFin360\n\nDATABASE_URL en `.env.example`.' },
      ]),
    ).toEqual([]);
  });
});

describe('gate de licencias', () => {
  it('rechaza una dependencia con licencia copyleft fuerte', () => {
    const violaciones = disallowedLicenses({
      MIT: [{ name: 'zod', versions: ['3.25.0'] }],
      'GPL-3.0': [{ name: 'paquete-copyleft', versions: ['1.0.0'] }],
    });

    expect(violaciones).toEqual([
      { name: 'paquete-copyleft', license: 'GPL-3.0', versions: ['1.0.0'] },
    ]);
  });

  it('rechaza una licencia indeterminada', () => {
    const violaciones = disallowedLicenses({
      Unknown: [{ name: 'sin-licencia', versions: ['0.1.0'] }],
    });

    expect(violaciones).toHaveLength(1);
  });

  it('acepta una expresión SPDX con OR si una parte está permitida', () => {
    expect(
      disallowedLicenses({ '(MIT OR GPL-3.0)': [{ name: 'dual', versions: ['1.0.0'] }] }),
    ).toEqual([]);
  });

  it('respeta una excepción revisada a mano', () => {
    const violaciones = disallowedLicenses(
      { 'GPL-3.0': [{ name: 'revisado', versions: ['1.0.0'] }] },
      { exceptions: { revisado: 'sólo se usa como binario en desarrollo' } },
    );

    expect(violaciones).toEqual([]);
  });

  it('acepta un árbol enteramente permisivo', () => {
    expect(
      disallowedLicenses({ MIT: [{ name: 'zod' }], 'Apache-2.0': [{ name: 'otro' }] }),
    ).toEqual([]);
  });
});

describe('gate de vulnerabilidades', () => {
  const reporte = {
    advisories: {
      1: { module_name: 'paquete-vulnerable', severity: 'high', title: 'Prototype pollution' },
      2: { module_name: 'otro', severity: 'low', title: 'ReDoS improbable' },
    },
  };

  it('falla con un aviso de severidad alta', () => {
    expect(auditFailures(reporte, 'high')).toEqual([
      { module: 'paquete-vulnerable', severity: 'high', title: 'Prototype pollution' },
    ]);
  });

  it('no falla si el umbral está por encima del aviso', () => {
    expect(auditFailures(reporte, 'critical')).toEqual([]);
  });

  it('entiende también el informe por recuento', () => {
    const porRecuento = { metadata: { vulnerabilities: { low: 3, high: 1, critical: 0 } } };

    expect(auditFailures(porRecuento, 'high')).toHaveLength(1);
  });

  it('acepta un informe limpio', () => {
    expect(auditFailures({ advisories: {}, metadata: { vulnerabilities: {} } }, 'high')).toEqual(
      [],
    );
  });

  it('rechaza una severidad desconocida', () => {
    expect(() => auditFailures(reporte, 'catastrofica')).toThrow(/Severidad desconocida/);
  });
});
