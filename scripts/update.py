#!/usr/bin/env python3
"""Safe Website Auditor .patch/.zip updates (no arbitrary commands from archives).

ZIP format: update-manifest.json containing {version:1,files:[
 {op:'add'|'modify'|'delete'|'rename', path:'...', old_path:'...',
  before:'sha256 or null', after:'sha256 or null'}]}.
New file bodies are stored at files/<path>. All file operations are within project root.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 120 * 1024 * 1024
FORBIDDEN = {'.env', '.git', 'node_modules', '.next', 'storage', 'test-results', 'playwright-report', '.auditor-backups'}

def safe_rel(value: str) -> str:
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        raise ValueError('Invalid path')
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or '..' in path.parts or '.' in path.parts or any(x in FORBIDDEN or x.startswith('.env') for x in path.parts):
        raise ValueError(f'Unsafe target path: {value}')
    return str(path)

def target(root: Path, value: str) -> Path:
    relative = safe_rel(value)
    path = root / relative
    # Prevent preexisting symlink parents or files from redirecting writes outside root.
    for check in (path, *path.parents):
        if check == root: break
        if check.is_symlink(): raise ValueError(f'Symlink target refused: {value}')
    if not path.resolve(strict=False).is_relative_to(root.resolve()):
        raise ValueError(f'Path outside project root: {value}')
    return path

def digest(payload: bytes) -> str: return hashlib.sha256(payload).hexdigest()
def file_digest(p: Path) -> str | None: return digest(p.read_bytes()) if p.is_file() else None

def dependencies_changed(root: Path, backup: Path, changed: list[str]) -> bool:
    """Script-only package changes do not require npm ci or network access."""
    if 'package-lock.json' in changed: return True
    if 'package.json' not in changed: return False
    original=backup/'files/package.json'
    updated=root/'package.json'
    if not original.is_file() or not updated.is_file(): return True
    before=json.loads(original.read_text()); after=json.loads(updated.read_text())
    return any(before.get(key)!=after.get(key) for key in
        ('dependencies','devDependencies','optionalDependencies','peerDependencies','overrides','engines','packageManager'))

def commands(root: Path, args):
    if not args.apply:
        print('CHECK ONLY; no project files changed')
        return
    if args.no_verify:
        print('Verification skipped at explicit request; deployment/restart disabled.')
        return
    # The updater formats only its touched supported files; unrelated local changes are untouched.
    if args.changed:
        pretty=[p for p in args.changed if p.endswith(('.ts','.tsx','.js','.mjs','.json','.css','.md','.yaml','.yml')) and (root/p).is_file()]
        if pretty:
            result=subprocess.run(['npm','run','format:files','--',*pretty],cwd=root,check=False)
            if result.returncode: raise RuntimeError('Formatter failed; services not restarted')
    result = subprocess.run(['bash', 'scripts/verify.sh'], cwd=root, check=False)
    if result.returncode:
        raise RuntimeError('Validation failed. Services NOT restarted. Review logs and rollback instructions.')
    app='lerd-app-website-auditor.service'; worker='website-auditor-worker.service'
    if not shutil.which('systemctl'):
        raise RuntimeError('BLOCKED: systemctl is unavailable; code validated but services were not restarted')
    # A successful build is not proof of a successful deployment. Surface every
    # unavailable/failed service and refuse to report a successful activation.
    deployment_errors=[]
    app_restarted=False
    for service in (app, worker):
        is_active = subprocess.run(['systemctl','--user','is-active','--quiet',service],check=False).returncode == 0
        if not is_active:
            deployment_errors.append(f'BLOCKED: {service} is not active; no restart attempted')
            continue
        completed=subprocess.run(['systemctl','--user','restart',service],check=False)
        if completed.returncode:
            deployment_errors.append(f'FAILED: could not restart {service}')
            continue
        completed=subprocess.run(['systemctl','--user','is-active','--quiet',service],check=False)
        if completed.returncode:
            deployment_errors.append(f'FAILED: {service} did not become active after restart')
        elif service == app:
            app_restarted=True
        print(f'{service}: {"active" if completed.returncode==0 else "FAILED health check"}')
    if app_restarted:
        if not shutil.which('curl'):
            deployment_errors.append('BLOCKED: curl is unavailable; HTTPS readiness not verified')
        else:
            result=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','8',
                                   'https://website-auditor.test/login'],check=False,stdout=subprocess.DEVNULL)
            if result.returncode:
                deployment_errors.append('FAILED: HTTPS readiness check failed at https://website-auditor.test/login')
            else:
                print('HTTPS readiness: PASS')
    if deployment_errors:
        for message in deployment_errors:
            print(message,file=sys.stderr)
        raise RuntimeError('Deployment not verified; retain the backup and review blocked/failed health checks above')
    print('Deployment: VERIFIED (quality gate, supervisor and HTTPS readiness)')

def parse_patch_paths(patch: bytes) -> list[str]:
    text = patch.decode('utf-8')
    paths: set[str] = set()
    # Reject binary patches and external commands; only git unified diff format is supported.
    if 'GIT binary patch' in text or '\x00' in text: raise ValueError('Binary patches are not supported')
    if not text.startswith('diff --git '): raise ValueError('Expected a Git unified patch')
    import re
    for line in text.splitlines():
        if line.startswith('diff --git '):
            match=re.fullmatch(r'diff --git a/(.+) b/(.+)',line)
            if not match: raise ValueError('Unsupported path quoting in Git patch')
            paths.update(map(safe_rel,match.groups()))
        elif line.startswith(('rename from ','rename to ','copy from ','copy to ')):
            paths.add(safe_rel(line.split(' ',2)[-1]))
    if not paths: raise ValueError('Empty patch')
    return sorted(paths)

def load_zip(z: zipfile.ZipFile):
    if 'update-manifest.json' not in z.namelist(): raise ValueError('ZIP requires update-manifest.json')
    if len(z.infolist()) > 3000: raise ValueError('ZIP has too many entries')
    if sum(i.file_size for i in z.infolist()) > MAX_TOTAL: raise ValueError('ZIP expands beyond maximum safe size')
    for item in z.infolist():
        if item.file_size > MAX_FILE: raise ValueError('Oversized ZIP member')
        if item.filename.endswith('/'): continue
        safe_rel(item.filename)
        if stat.S_IFMT(item.external_attr >> 16) == stat.S_IFLNK: raise ValueError('ZIP symlinks are disallowed')
    data=json.loads(z.read('update-manifest.json'))
    if data.get('version') != 1 or not isinstance(data.get('files'),list): raise ValueError('Unsupported update manifest')
    actions=[]
    seen=set()
    for item in data['files']:
        op=item.get('op'); name=safe_rel(item.get('path',''))
        if op not in ('add','modify','delete','rename') or name in seen: raise ValueError('Invalid or duplicate operation')
        seen.add(name)
        old=safe_rel(item.get('old_path','')) if op=='rename' else name
        before=item.get('before');after=item.get('after')
        if op!='add' and (not isinstance(before,str) or len(before)!=64): raise ValueError('Missing before digest')
        if op!='delete' and (not isinstance(after,str) or len(after)!=64): raise ValueError('Missing after digest')
        content=None
        if op!='delete':
            member='files/'+name
            if member not in z.namelist(): raise ValueError(f'Missing payload: {member}')
            content=z.read(member)
            if digest(content)!=after: raise ValueError(f'Payload checksum mismatch: {name}')
        actions.append((op,name,old,before,after,content))
    if not actions: raise ValueError('Empty update')
    return actions

def formatter_equivalent(root: Path, name: str, expected: bytes, actual: bytes) -> bool:
    """Permit only formatting-equivalent local changes, never semantic overwrites.

    An update may carry an exact pre-image under base/<path>. The manifest's
    before-SHA256 must match this pre-image. We compare canonical Prettier output
    for both versions using the project's already installed formatter.
    """
    if not name.endswith(('.ts', '.tsx', '.js', '.mjs', '.json', '.css', '.md')):
        return False
    prettier=root/'node_modules/.bin/prettier'
    if not prettier.is_file() or prettier.is_symlink():
        return False
    def canonical(data: bytes) -> bytes | None:
        proc=subprocess.run([str(prettier), '--stdin-filepath', name], cwd=root,
                            input=data, capture_output=True, timeout=45, check=False)
        return proc.stdout if proc.returncode == 0 else None
    a=canonical(expected); b=canonical(actual)
    return a is not None and b is not None and a == b

def main():
    parser=argparse.ArgumentParser(description='Apply a verified Website Auditor Git patch or manifest ZIP with recoverable backups')
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check',action='store_true');group.add_argument('--apply',action='store_true')
    parser.add_argument('--force',action='store_true',help='Only with --apply; controlled overwrite of ZIP hash conflicts')
    parser.add_argument('--no-verify',action='store_true',help='Explicitly skip validation; NEVER restart services')
    parser.add_argument('--project',default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument('archive')
    args=parser.parse_args()
    if args.force and not args.apply: parser.error('--force requires --apply')
    root=Path(args.project).resolve(); archive=Path(args.archive).resolve()
    if not root.is_dir() or not archive.is_file(): parser.error('Project directory and update file must exist')
    backup_root=root/'.auditor-backups';stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+f'-{os.getpid()}'
    backup=backup_root/stamp
    actions=[]
    patch=archive.suffix.lower() in ('.patch','.diff')
    if patch:
        raw=archive.read_bytes()
        names=parse_patch_paths(raw)
        for name in names:target(root,name)
        check=subprocess.run(['git','apply','--check','--unsafe-paths' if False else '--verbose',str(archive)],cwd=root,capture_output=True,text=True)
        if check.returncode:
            # --force does not mean silently overwriting unrelated local modifications.
            raise ValueError('Patch conflicts (manual reconciliation required): '+(check.stderr.strip() or check.stdout.strip()))
        actions=[('patch',name,name,file_digest(target(root,name)),None,None) for name in names]
    elif archive.suffix.lower()=='.zip':
        with zipfile.ZipFile(archive) as z:
            actions=load_zip(z)
            baseline_content={}
            for op,name,old,before,after,content in actions:
                member='base/'+old
                if member in z.namelist():
                    payload=z.read(member)
                    if digest(payload)!=before:
                        raise ValueError(f'Baseline checksum mismatch: {old}')
                    baseline_content[old]=payload
        conflicts=[]
        for op,name,old,before,after,content in actions:
            dest=target(root,name);source=target(root,old)
            existing=file_digest(source)
            if op=='add' and dest.exists():conflicts.append(name+' (already exists)')
            elif op!='add' and existing != before:
                base=baseline_content.get(old)
                if (base is not None and existing is not None
                        and formatter_equivalent(root, old, base, source.read_bytes())):
                    print(f'Formatting-only local differences accepted: {old}')
                else:
                    conflicts.append(old+' (checksum changed)')
            if op=='rename' and dest.exists() and dest!=source:conflicts.append(name+' (rename destination exists)')
        if conflicts:
            print('Conflicting files:\n- '+'\n- '.join(conflicts),file=sys.stderr)
            if args.check: raise ValueError('Update not compatible with current files')
            if not args.force:
                if not sys.stdin.isatty():raise ValueError('Noninteractive conflict: use --apply --force only after reviewing changes')
                answer=input(f'Normal patch could not be applied. Conflicting files: {len(conflicts)}\nRetry with --force? (yes/no) [no]: ').strip().lower()
                if answer not in ('yes','y'):raise ValueError('Stopped without overwriting conflicting changes')
    else: raise ValueError('Only .zip, .patch, or .diff updates are supported')
    print('Update operations:')
    for op,name,old,*_ in actions:print(' -',op,old, '-> '+name if old!=name else '')
    if args.check:return 0
    backup.mkdir(parents=True,exist_ok=False)
    affected=sorted(set([x[1] for x in actions]+[x[2] for x in actions]))
    state={}
    for name in affected:
        path=target(root,name)
        if path.is_dir():raise ValueError('Directories cannot be updated as file entries')
        exists=path.exists();state[name]={'exists':exists,'sha256':file_digest(path)}
        if exists:
            dest=backup/'files'/name
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(path,dest)
    (backup/'rollback.json').write_text(json.dumps({'project':str(root),'archive':str(archive),'files':state,'at':stamp},indent=2))
    (backup/'ROLLBACK.txt').write_text('Backups are in files/. Restore only after stopping services and reviewing rollback.json. Use: python3 scripts/update.py --rollback '+str(backup)+'\n')
    print('Backup:',backup)
    try:
        if patch:
            subprocess.run(['git','apply',str(archive)],cwd=root,check=True)
        else:
            for op,name,old,before,after,content in actions:
                dest=target(root,name);source=target(root,old)
                if op in ('delete','rename') and source.exists():source.unlink()
                if content is not None:
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    tmp=dest.with_name(dest.name+'.auditor-temp-'+str(os.getpid()))
                    tmp.write_bytes(content);os.replace(tmp,dest)
                    if file_digest(dest)!=after:raise RuntimeError('Applied file failed integrity verification')
    except Exception:
        restore(root,backup)
        raise
    print('Source update applied; verifying before service activation...')
    args.changed=[name for op,name,old,*_ in actions if op!='delete']
    if not args.no_verify and dependencies_changed(root, backup, args.changed):
        result=subprocess.run(['npm','ci','--no-audit','--no-fund'],cwd=root,check=False)
        if result.returncode: raise RuntimeError('Dependency install failed; services NOT restarted')
    commands(root,args)
    print('Report and recovery:',backup)
    return 0

def restore(root:Path,backup:Path):
    record=json.loads((backup/'rollback.json').read_text())
    if root.resolve()!=Path(record['project']).resolve():raise ValueError('Rollback project mismatch')
    for name,meta in record['files'].items():
        dest=target(root,name)
        if meta['exists']:
            saved=backup/'files'/name
            if file_digest(saved)!=meta['sha256']:raise ValueError('Backup integrity check failed')
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(saved,dest)
        elif dest.exists():dest.unlink()

if __name__=='__main__':
    try:
        if '--rollback' in sys.argv:
            idx=sys.argv.index('--rollback'); backup=Path(sys.argv[idx+1]).resolve()
            rec=json.loads((backup/'rollback.json').read_text())
            restore(Path(rec['project']).resolve(),backup)
            print('Files restored from',backup,'; no database or RustFS changes made')
        else:sys.exit(main())
    except (ValueError,OSError,RuntimeError,zipfile.BadZipFile,subprocess.CalledProcessError) as e:
        print('UPDATE FAILED:',e,file=sys.stderr);sys.exit(1)
