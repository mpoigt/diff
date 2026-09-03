'use strict';

const express = require('express');
const controller = require('../controllers/diffs.controller');

const router = express.Router();

router.get('/', controller.getAll);
router.post('/', controller.create);

router.get('/:id', controller.getOne);
router.get('/:id/patch', controller.getPatch);
router.put('/:id', controller.replace);
router.patch('/:id', controller.patch);
router.delete('/:id', controller.remove);

module.exports = router;
