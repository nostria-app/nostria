const target = process.argv[2] || process.env['BASE_URL'] || 'http://localhost:4000';

async function main() {
  const response = await fetch(target, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'NostriaFrameProtectionCheck/1.0',
    },
  });

  const contentSecurityPolicy = response.headers.get('content-security-policy');
  const xFrameOptions = response.headers.get('x-frame-options');

  if (!contentSecurityPolicy) {
    throw new Error('Missing Content-Security-Policy header');
  }

  if (!/frame-ancestors\s+'none'/i.test(contentSecurityPolicy)) {
    throw new Error(`Content-Security-Policy is missing frame-ancestors 'none': ${contentSecurityPolicy}`);
  }

  if (xFrameOptions?.toUpperCase() !== 'DENY') {
    throw new Error(`Expected X-Frame-Options DENY, got: ${xFrameOptions ?? '(missing)'}`);
  }

  console.log(`Frame protection headers verified for ${target}`);
  console.log(`Content-Security-Policy: ${contentSecurityPolicy}`);
  console.log(`X-Frame-Options: ${xFrameOptions}`);
}

main().catch((error) => {
  console.error(`Frame protection check failed for ${target}`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
