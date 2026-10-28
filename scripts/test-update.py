#!/usr/bin/env python3
"""Dependency-free updater safety regressions, executed as Python unittest."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SPEC=importlib.util.spec_from_file_location('update',Path(__file__).with_name('update.py'))
assert SPEC and SPEC.loader
update=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(update)

class UpdateTest(unittest.TestCase):
    def test_rejects_traversal_and_secrets(self):
        for value in ('../a','/tmp/a','a/../../b','a//b','a\\b','.env','private/.env.prod','node_modules/a','storage/a'):
            with self.subTest(path=value), self.assertRaises(ValueError): update.safe_rel(value)
    def test_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'link').symlink_to('/tmp',target_is_directory=True)
            with self.assertRaises(ValueError):update.target(root,'link/evil')
    def test_zip_checksum_and_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            existing=root/'main.ts';existing.write_text('original')
            before=update.digest(existing.read_bytes()); content=b'changed'
            archive=root/'update.zip'
            manifest={'version':1,'files':[{'op':'modify','path':'main.ts','before':before,'after':update.digest(content)}]}
            with zipfile.ZipFile(archive,'w') as z:
                z.writestr('update-manifest.json',json.dumps(manifest))
                z.writestr('files/main.ts',content)
            with zipfile.ZipFile(archive) as z:actions=update.load_zip(z)
            self.assertEqual(actions[0][-1],content)
            manifest['files'][0]['after']='0'*64
            with zipfile.ZipFile(root/'bad.zip','w') as z:
                z.writestr('update-manifest.json',json.dumps(manifest));z.writestr('files/main.ts',content)
            with zipfile.ZipFile(root/'bad.zip') as z,self.assertRaises(ValueError):update.load_zip(z)
    def test_script_only_package_change_does_not_install_dependencies(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); archive=root/'.auditor-backups'/'sample'/'files';archive.mkdir(parents=True)
            original={'scripts':{'worker':'old'},'dependencies':{'react':'19'}}
            updated={'scripts':{'worker':'new'},'dependencies':{'react':'19'}}
            (archive/'package.json').write_text(json.dumps(original));(root/'package.json').write_text(json.dumps(updated))
            self.assertFalse(update.dependencies_changed(root,archive.parent,['package.json']))
            updated['dependencies']['react']='20';(root/'package.json').write_text(json.dumps(updated))
            self.assertTrue(update.dependencies_changed(root,archive.parent,['package.json']))

    def test_formatting_only_conflicts_can_be_normalized_without_force(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            binary=root/'node_modules' / '.bin' / 'prettier';binary.parent.mkdir(parents=True)
            binary.write_text('#!/usr/bin/env python3\nimport sys,re\nsys.stdout.write(re.sub(r"\\s+", "", sys.stdin.read()))\n')
            binary.chmod(0o755)
            expected=b'const count= 1;\n'
            formatted=b'const count = 1;\n'
            self.assertTrue(update.formatter_equivalent(root,'src/test.ts',expected,formatted))
            self.assertFalse(update.formatter_equivalent(root,'src/test.ts',expected,b'const count=2;'))
            self.assertFalse(update.formatter_equivalent(root,'.env',expected,formatted))

    def test_patch_rejects_unsafe_paths(self):
        for patch in (b'diff --git a/../secret b/../secret\n',b'diff --git a/.env b/.env\n'):
            with self.assertRaises(ValueError):update.parse_patch_paths(patch)

if __name__=='__main__': unittest.main()
