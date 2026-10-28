#!/usr/bin/env python3
"""Dependency-free regression tests for updater deployment health semantics."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import unittest

MODULE = Path(__file__).resolve().with_name('update.py')
spec = importlib.util.spec_from_file_location('auditor_updater', MODULE)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)

class DeploymentChecks(unittest.TestCase):
    def check(self, returncodes, which=lambda name: '/usr/bin/' + name):
        with TemporaryDirectory() as root:
            args = SimpleNamespace(apply=True, no_verify=False, changed=[])
            responses = iter(returncodes)
            with patch.object(updater.shutil, 'which', side_effect=which), \
                 patch.object(updater.subprocess, 'run', side_effect=lambda *a, **kw: SimpleNamespace(returncode=next(responses))):
                updater.commands(Path(root), args)

    def test_successful_pipeline_and_health(self):
        # npm quality gate; app active/restart/health; worker active/restart/health; HTTPS ready.
        self.check([0,0,0,0,0,0,0,0])

    def test_failed_quality_gate_never_restarts(self):
        with self.assertRaisesRegex(RuntimeError, 'Validation failed'):
            self.check([1])

    def test_failed_worker_restart_prevents_success_claim(self):
        with self.assertRaisesRegex(RuntimeError, 'Deployment not verified'):
            self.check([0,0,0,0,0,1,0])

    def test_unavailable_unit_is_blocker(self):
        with self.assertRaisesRegex(RuntimeError, 'Deployment not verified'):
            self.check([0,0,0,0,1,0])

    def test_failed_https_probe_prevents_success_claim(self):
        with self.assertRaisesRegex(RuntimeError, 'Deployment not verified'):
            self.check([0,0,0,0,0,0,0,1])

    def test_no_supervisor_is_blocker(self):
        with self.assertRaisesRegex(RuntimeError, 'BLOCKED'):
            self.check([0], which=lambda name: None if name=='systemctl' else '/usr/bin/' + name)

if __name__=='__main__':
    unittest.main()
