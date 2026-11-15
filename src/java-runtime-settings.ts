export type JavaSetting = 'jdkhome' | 'project.jdkhome';
export type JavaRuntimeBackup = {
  serverBefore?: string | null;
  projectBefore?: string | null;
  serverAfter: string;
  projectAfter?: string;
  changedProject: boolean;
};
export interface JavaRuntimeSettings {
  get(key: JavaSetting): string | null | undefined;
  update(key: JavaSetting, value: string | null | undefined): PromiseLike<void>;
  save(backup: JavaRuntimeBackup | undefined): PromiseLike<void>;
}
// Project settings go first so changing the server never silently upgrades project compilation.
export async function applyJavaRuntime(
  settings: JavaRuntimeSettings,
  selected: string,
  preserveProject?: string,
) {
  const backup: JavaRuntimeBackup = {
    serverBefore: settings.get('jdkhome'),
    projectBefore: settings.get('project.jdkhome'),
    serverAfter: selected,
    changedProject: !!preserveProject && !settings.get('project.jdkhome'),
    ...(preserveProject ? { projectAfter: preserveProject } : {}),
  };
  await settings.save(backup);
  try {
    if (
      settings.get('jdkhome') !== backup.serverBefore ||
      settings.get('project.jdkhome') !== backup.projectBefore
    )
      throw Error('Java settings changed during setup. Please retry.');
    if (backup.changedProject) await settings.update('project.jdkhome', backup.projectAfter);
    if (settings.get('jdkhome') !== backup.serverBefore)
      throw Error('Java server settings changed during setup. Please retry.');
    await settings.update('jdkhome', selected);
  } catch (error) {
    if (backup.changedProject && settings.get('project.jdkhome') === backup.projectAfter)
      await settings.update('project.jdkhome', backup.projectBefore);
    await settings.save(undefined);
    throw error;
  }
  return backup;
}
export async function restoreJavaRuntime(
  settings: JavaRuntimeSettings,
  backup: JavaRuntimeBackup,
): Promise<boolean> {
  if (
    settings.get('jdkhome') !== backup.serverAfter ||
    (backup.changedProject && settings.get('project.jdkhome') !== backup.projectAfter)
  )
    return false;
  // Keep the project pinned if restoring the server fails.
  await settings.update('jdkhome', backup.serverBefore);
  if (backup.changedProject) await settings.update('project.jdkhome', backup.projectBefore);
  await settings.save(undefined);
  return true;
}
