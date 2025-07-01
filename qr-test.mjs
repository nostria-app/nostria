import encodeQR from './node_modules/qr/index.js';

console.log('Testing QR library...');

// Test basic QR generation
try {
    const text = 'Hello World';
    console.log('Generating QR for:', text);
    
    // Test different output formats
    const raw = encodeQR(text, 'raw');
    console.log('Raw format (2D array):', raw.length, 'x', raw[0].length);
    
    const ascii = encodeQR(text, 'ascii');
    console.log('ASCII format generated successfully');
    console.log('ASCII result preview (first 5 lines):');
    console.log(ascii.split('\n').slice(0, 5).join('\n'));
    
    const svg = encodeQR(text, 'svg');
    console.log('SVG format generated successfully, length:', svg.length);
    
    const gif = encodeQR(text, 'gif');
    console.log('GIF format generated successfully, size:', gif.length, 'bytes');
    
    // Test with options
    const svgWithOptions = encodeQR(text, 'svg', { 
        ecc: 'high', 
        scale: 4,
        border: 1
    });
    console.log('SVG with options generated successfully');
    
    console.log('All formats working!');
    
    // Test how to render to canvas (which is what we need)
    // The raw format gives us a 2D boolean array
    console.log('Raw data sample (first few rows):');
    raw.slice(0, 3).forEach((row, i) => {
        console.log(`Row ${i}:`, row.slice(0, 10).map(cell => cell ? '█' : ' ').join(''));
    });
    
} catch (error) {
    console.error('Error:', error.message);
}