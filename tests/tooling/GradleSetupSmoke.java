import java.io.File;
import java.nio.file.Files;
import org.gradle.tooling.GradleConnector;
import org.gradle.tooling.ProjectConnection;
import org.gradle.tooling.model.build.BuildEnvironment;
import org.gradle.tooling.model.idea.IdeaProject;

/** Run using the Tooling API shipped with IntelliJ 2022.3, without an explicit Java home. */
public class GradleSetupSmoke {
    public static void main(String[] args) throws Exception {
        try (ProjectConnection connection = GradleConnector.newConnector()
                .forProjectDirectory(new File(args[0]).getAbsoluteFile())
                .useGradleUserHomeDir(new File(args[1]).getAbsoluteFile())
                .useBuildDistribution().connect()) {
            BuildEnvironment environment = connection.getModel(BuildEnvironment.class);
            if (!environment.getGradle().getGradleVersion().equals("8.14.6"))
                throw new AssertionError("The importer ignored the pinned wrapper");
            String release = Files.readString(environment.getJava().getJavaHome().toPath().resolve("release"));
            if (!release.contains("JAVA_VERSION=\"17."))
                throw new AssertionError("The importer ignored the generated Java 17 setting");
            IdeaProject project = connection.model(IdeaProject.class)
                .withArguments("-PlocalIdePath=" + args[2]).get();
            if (!project.getJavaLanguageSettings().getLanguageLevel().getMajorVersion().equals("17"))
                throw new AssertionError("Wrong project language level");
            System.out.println("PASS: IntelliJ 2022.3 Tooling API imports Gradle 8.14.6 on Java 17");
        }
        // The older standalone Tooling API keeps idle worker threads alive after disconnect.
        System.exit(0);
    }
}
