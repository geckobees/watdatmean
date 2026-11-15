plugins {
    java
    id("org.jetbrains.intellij") version "1.17.4"
}

group = "com.watdatmean"
version = "0.1.11"

repositories {
    mavenCentral()
}
intellij {
    version.set("2022.3")
    type.set("IC")
    plugins.set(listOf("com.intellij.java"))
    providers.gradleProperty("localIdePath").orNull?.let { localPath.set(it) }
}
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
tasks.withType<JavaCompile>().configureEach { options.release.set(17) }
tasks.patchPluginXml { sinceBuild.set("223"); untilBuild.set("252.*") }
val buildEngine by tasks.registering(Exec::class) {
    workingDir = rootDir.parentFile
    commandLine(providers.gradleProperty("nodeExecutable").getOrElse("node"), "scripts/build-intellij.mjs")
    inputs.dir("../src")
    inputs.dir("../media")
    inputs.file("../scripts/build-intellij.mjs")
    outputs.dir(layout.buildDirectory.dir("generated/web"))
}
sourceSets.main { resources.srcDir(layout.buildDirectory.dir("generated")) }
tasks.processResources { dependsOn(buildEngine) }
tasks.prepareSandbox {
    from("../LICENSE", "../THIRD_PARTY_NOTICES.md") { into("${project.name}") }
    from("../licenses") { into("${project.name}/licenses") }
}
