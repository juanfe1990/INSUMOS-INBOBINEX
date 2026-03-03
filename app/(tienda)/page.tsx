import { AboutSection } from '@/components/about-section';
import BlogSection from '@/components/blogSection';
import { ContactSection } from '@/components/contact-section';
import { FeaturesStrip } from '@/components/features-strip';
import { HeroSection } from '@/components/hero-section';
import { ProductsSection } from '@/components/products-section';
import SocialButtons from '@/components/socialButtons';
import { getSortedPostsData } from '@/lib/post';
import { PostData } from '@/lib/types';

export default function HomePage() {
    const allPosts: PostData[] = getSortedPostsData();
    return (
        <div>
            <HeroSection />
            <AboutSection />
            <ProductsSection />
            <FeaturesStrip />
            <ContactSection />
            <SocialButtons />
            <BlogSection posts={allPosts} />
        </div>
    );
}
