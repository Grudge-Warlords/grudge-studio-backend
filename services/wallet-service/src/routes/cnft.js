'use strict';
const express = require('express');
const router  = express.Router();
const { Connection, PublicKey } = require('@solana/web3.js');

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// ── POST /cnft/update ─────────────────────────────────────────────────────────
// Called by game-api after inventory changes.
// Updates cNFT on-chain if the character has a minted Bubblegum cNFT.
// Phase 1: logs the update request (R2 metadata is already updated)
// Phase 2: add @metaplex-foundation/mpl-bubblegum call here
router.post('/update', async (req, res, next) => {
  try {
    const { grudge_id, metadataUri, nft_mint } = req.body;
    if (!grudge_id || !metadataUri) {
      return res.status(400).json({ error: 'grudge_id and metadataUri required' });
    }

    // Phase 1: R2 is already updated (no-op here, log only)
    if (!nft_mint) {
      console.log(`[cnft] metadata updated in R2 (no on-chain mint yet): ${grudge_id}`);
      return res.json({ success: true, onChain: false, metadataUri });
    }

    // Phase 2 placeholder: Bubblegum updateMetadata call
    // TODO: Uncomment when @metaplex-foundation/mpl-bubblegum is installed
    //
    // const umi = createUmi(SOLANA_RPC).use(mplBubblegum());
    // const authority = umi.eddsa.createKeypairFromSecretKey(TREE_AUTHORITY_KEY);
    // await updateMetadata(umi, {
    //   leafOwner: publicKey(owner_wallet),
    //   currentMetadata: currentMeta,
    //   updateArgs: { uri: some(metadataUri) },
    // }).sendAndConfirm(umi);

    console.log(`[cnft] Phase 2 pending: nft_mint=${nft_mint} metadataUri=${metadataUri}`);
    res.json({ success: true, onChain: false, pending: true, metadataUri, note: 'R2 updated; on-chain update queued for Phase 2' });
  } catch (err) { next(err); }
});

// ── GET /cnft/metadata/:grudge_id ─────────────────────────────────────────────
// Returns the current metadata URI for a character
router.get('/metadata/:grudge_id', async (req, res, next) => {
  try {
    const PUBLIC_URL = process.env.OBJECT_STORAGE_PUBLIC_URL?.replace(/\/$/, '');
    const uri = `${PUBLIC_URL}/characters/${req.params.grudge_id}/metadata.json`;
    res.json({ grudge_id: req.params.grudge_id, metadataUri: uri });
  } catch (err) { next(err); }
});

module.exports = router;
