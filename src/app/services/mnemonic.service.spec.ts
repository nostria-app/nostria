// Simple test to verify mnemonic functionality
import { TestBed } from '@angular/core/testing';
import { MnemonicService } from './mnemonic.service';
import { LoggerService } from './logger.service';
import { CryptoEncryptionService } from './crypto-encryption.service';

describe('MnemonicService', () => {
  let service: MnemonicService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MnemonicService,
        LoggerService,
        CryptoEncryptionService,
      ],
    });
    service = TestBed.inject(MnemonicService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should generate a valid 12-word mnemonic', () => {
    const mnemonic = service.generateMnemonic();
    expect(mnemonic).toBeTruthy();
    
    const words = mnemonic.split(' ');
    expect(words.length).toBe(12);
    
    const isValid = service.validateMnemonic(mnemonic);
    expect(isValid).toBe(true);
  });

  it('should validate NIP-06 test vector 1', () => {
    const mnemonic = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
    const expectedPrivkey = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
    
    const isValid = service.validateMnemonic(mnemonic);
    expect(isValid).toBe(true);
    
    const derivedPrivkey = service.derivePrivateKeyFromMnemonic(mnemonic);
    expect(derivedPrivkey).toBe(expectedPrivkey);
  });

  it('should validate NIP-06 test vector 2', () => {
    const mnemonic = 'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';
    const expectedPrivkey = 'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add';
    
    const isValid = service.validateMnemonic(mnemonic);
    expect(isValid).toBe(true);
    
    const derivedPrivkey = service.derivePrivateKeyFromMnemonic(mnemonic);
    expect(derivedPrivkey).toBe(expectedPrivkey);
  });

  it('should detect mnemonic phrases correctly', () => {
    const validMnemonic = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
    expect(service.isMnemonic(validMnemonic)).toBe(true);
    
    const nsec = 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp';
    expect(service.isMnemonic(nsec)).toBe(false);
    
    const hex = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
    expect(service.isMnemonic(hex)).toBe(false);
  });

  it('should normalize mnemonic phrases', () => {
    const mnemonic = '  leader  monkey   parrot ring  guide   ';
    const normalized = service.normalizeMnemonic(mnemonic);
    expect(normalized).toBe('leader monkey parrot ring guide');
  });

  it('should reject invalid mnemonics', () => {
    const invalidMnemonic = 'invalid words that are not in the wordlist';
    expect(service.validateMnemonic(invalidMnemonic)).toBe(false);
    
    const tooFewWords = 'only three words';
    expect(service.validateMnemonic(tooFewWords)).toBe(false);
  });

  it('should encrypt and decrypt mnemonics', async () => {
    const mnemonic = service.generateMnemonic();
    const pin = '1234';
    
    const encrypted = await service.encryptMnemonic(mnemonic, pin);
    expect(encrypted).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.salt).toBeTruthy();
    
    const decrypted = await service.decryptMnemonic(encrypted, pin);
    expect(decrypted).toBe(mnemonic);
  });

  it('should fail decryption with wrong PIN', async () => {
    const mnemonic = service.generateMnemonic();
    const pin = '1234';
    const wrongPin = '5678';
    
    const encrypted = await service.encryptMnemonic(mnemonic, pin);
    
    await expectAsync(
      service.decryptMnemonic(encrypted, wrongPin)
    ).toBeRejectedWithError();
  });
});
